import {
  CommandId,
  EnvironmentId,
  MessageId,
  ORCHESTRATION_WS_METHODS,
  ThreadId,
  type ClientOrchestrationCommand,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Latch from "effect/Latch";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import { createThreadEnvironmentAtoms } from "./threadCommands.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

const THREAD_ID = ThreadId.make("thread-1");

const TEST_CRYPTO_LAYER = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => new Uint8Array(size),
    digest: (_algorithm, data) => Effect.succeed(data),
  }),
);

function session(client: WsRpcProtocolClient): RpcSession {
  return {
    client,
    initialConfig: Effect.never,
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
}

describe("thread environment commands", () => {
  it.effect("dispatches an interrupt outside a blocked same-thread command lane", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const startDispatched = Latch.makeUnsafe();
        const releaseStart = Latch.makeUnsafe();
        const events: string[] = [];
        const client = {
          [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command: ClientOrchestrationCommand) =>
            Effect.gen(function* () {
              events.push(`${command.type}:dispatch`);
              if (command.type === "thread.turn.start") {
                startDispatched.openUnsafe();
                yield* releaseStart.await;
              }
              events.push(`${command.type}:complete`);
              return { sequence: events.length };
            }),
        } as unknown as WsRpcProtocolClient;
        const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
          target: TARGET,
          state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
          session: yield* SubscriptionRef.make(Option.some(session(client))),
          prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
          connect: Effect.void,
          disconnect: Effect.void,
          retryNow: Effect.void,
        } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
        const run: EnvironmentRegistry.EnvironmentRegistry["Service"]["run"] = (
          _environmentId,
          effect,
        ) => Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor);
        const environmentRegistry = EnvironmentRegistry.EnvironmentRegistry.of({
          run,
        } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"]);
        const runtime = Atom.runtime(
          Layer.merge(
            TEST_CRYPTO_LAYER,
            Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environmentRegistry),
          ),
        );
        const atoms = createThreadEnvironmentAtoms(runtime);
        const registry = yield* Effect.acquireRelease(Effect.sync(AtomRegistry.make), (registry) =>
          Effect.sync(() => registry.dispose()),
        );
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            releaseStart.openUnsafe();
          }),
        );

        const start = atoms.startTurn.run(registry, {
          environmentId: TARGET.environmentId,
          input: {
            threadId: THREAD_ID,
            commandId: CommandId.make("start-command"),
            message: {
              messageId: MessageId.make("message-1"),
              role: "user",
              text: "Run a blocking tool",
              attachments: [],
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            createdAt: "2026-09-01T00:00:00.000Z",
          },
        });
        yield* startDispatched.await;

        const metadata = atoms.updateMetadata.run(registry, {
          environmentId: TARGET.environmentId,
          input: {
            threadId: THREAD_ID,
            commandId: CommandId.make("metadata-command"),
            title: "Queued title",
          },
        });
        const interrupted = yield* Effect.promise(() =>
          atoms.interruptTurn.run(registry, {
            environmentId: TARGET.environmentId,
            input: {
              threadId: THREAD_ID,
              commandId: CommandId.make("interrupt-command"),
              createdAt: "2026-09-01T00:00:01.000Z",
            },
          }),
        );

        expect(AsyncResult.isSuccess(interrupted)).toBe(true);
        expect(events).toEqual([
          "thread.turn.start:dispatch",
          "thread.turn.interrupt:dispatch",
          "thread.turn.interrupt:complete",
        ]);

        releaseStart.openUnsafe();
        const [started, metadataUpdated] = yield* Effect.promise(() =>
          Promise.all([start, metadata]),
        );

        expect(AsyncResult.isSuccess(started)).toBe(true);
        expect(AsyncResult.isSuccess(metadataUpdated)).toBe(true);
        expect(events).toEqual([
          "thread.turn.start:dispatch",
          "thread.turn.interrupt:dispatch",
          "thread.turn.interrupt:complete",
          "thread.turn.start:complete",
          "thread.meta.update:dispatch",
          "thread.meta.update:complete",
        ]);
      }),
    ),
  );
});
