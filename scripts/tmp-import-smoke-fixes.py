from pathlib import Path


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} anchor(s), found {count}")
    p.write_text(text.replace(old, new), encoding="utf-8")


replace_exact(
    "apps/server/src/threadImport/ThreadImportService.ts",
    '''function canonicalCodexInstances(instances: ReadonlyArray<ProviderInstance>) {
  const byContinuationKey = new Map<string, ImportCapableProviderInstance>();
  for (const instance of instances) {
    if (instance.driverKind !== CODEX_DRIVER || !instance.enabled || !hasThreadImport(instance))
      continue;
    const key = instance.continuationIdentity.continuationKey;
    if (!byContinuationKey.has(key)) byContinuationKey.set(key, instance);
  }
  return [...byContinuationKey.values()];
}''',
    '''function canonicalCodexInstances(
  instances: ReadonlyArray<ProviderInstance>,
  preferredInstanceId: ProviderInstanceId | null | undefined,
) {
  const byContinuationKey = new Map<string, ImportCapableProviderInstance>();
  for (const instance of instances) {
    if (instance.driverKind !== CODEX_DRIVER || !instance.enabled || !hasThreadImport(instance))
      continue;
    const key = instance.continuationIdentity.continuationKey;
    const existing = byContinuationKey.get(key);
    if (
      existing === undefined ||
      (preferredInstanceId !== null &&
        preferredInstanceId !== undefined &&
        instance.instanceId === preferredInstanceId &&
        existing.instanceId !== preferredInstanceId)
    ) {
      byContinuationKey.set(key, instance);
    }
  }
  return [...byContinuationKey.values()];
}''',
)

replace_exact(
    "apps/server/src/threadImport/ThreadImportService.ts",
    "      const instances = canonicalCodexInstances(yield* providerInstances.listInstances);",
    '''      const instances = canonicalCodexInstances(
        yield* providerInstances.listInstances,
        project.defaultModelSelection?.instanceId,
      );''',
)

replace_exact(
    "apps/server/src/orchestration/decider.ts",
    '''      return [createdEvent, ...messageEvents, timestampEvent];''',
    '''      const activeEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.updatedAt,
          commandId: command.commandId,
        })),
        type: "thread.unsettled",
        payload: {
          threadId: command.threadId,
          reason: "user",
          updatedAt: command.updatedAt,
        },
      };

      return [createdEvent, ...messageEvents, timestampEvent, activeEvent];''',
)

replace_exact(
    "apps/server/src/threadImport/ThreadImportService.test.ts",
    '''function makeProvider(threadImport: ProviderThreadImportShape): ProviderInstance {''',
    '''function makeProvider(
  threadImport: ProviderThreadImportShape,
  options: {
    readonly providerInstanceId?: ProviderInstanceId;
    readonly continuationKey?: string;
  } = {},
): ProviderInstance {''',
)

replace_exact(
    "apps/server/src/threadImport/ThreadImportService.test.ts",
    '''  return {
    instanceId,
    driverKind,
    continuationIdentity: {
      driverKind,
      continuationKey: "codex:test-home",
    },''',
    '''  const providerInstanceId = options.providerInstanceId ?? instanceId;
  return {
    instanceId: providerInstanceId,
    driverKind,
    continuationIdentity: {
      driverKind,
      continuationKey: options.continuationKey ?? "codex:test-home",
    },''',
)

replace_exact(
    "apps/server/src/threadImport/ThreadImportService.test.ts",
    '''function makeHarness(options: {
  readonly candidates: ReadonlyArray<ProviderThreadImportCandidate>;
  readonly scan?: ProviderThreadImportShape["scan"];
  readonly read: ProviderThreadImportShape["read"];
  readonly sessionUpsert?: ProviderSessionDirectory["Service"]["upsert"];
}) {''',
    '''function makeHarness(options: {
  readonly candidates: ReadonlyArray<ProviderThreadImportCandidate>;
  readonly scan?: ProviderThreadImportShape["scan"];
  readonly read: ProviderThreadImportShape["read"];
  readonly sessionUpsert?: ProviderSessionDirectory["Service"]["upsert"];
  readonly providers?: ReadonlyArray<ProviderInstance>;
  readonly project?: OrchestrationProjectShell;
}) {''',
)

replace_exact(
    "apps/server/src/threadImport/ThreadImportService.test.ts",
    '''    getProjectShellById: () => Effect.succeed(Option.some(project)),''',
    '''    getProjectShellById: () => Effect.succeed(Option.some(options.project ?? project)),''',
)

replace_exact(
    "apps/server/src/threadImport/ThreadImportService.test.ts",
    '''    listInstances: Effect.succeed([provider]),''',
    '''    listInstances: Effect.succeed(options.providers ?? [provider]),''',
)

p = Path("apps/server/src/threadImport/ThreadImportService.test.ts")
text = p.read_text(encoding="utf-8")
anchor = '''  it.effect(
    "isolates transcript read failures so another selected conversation can still import",'''
if text.count(anchor) != 1:
    raise SystemExit(f"ThreadImportService.test.ts: expected existing final-test anchor once, got {text.count(anchor)}")
if not text.endswith("});\n"):
    raise SystemExit("ThreadImportService.test.ts: unexpected file ending")
new_test = r'''

  it.effect(
    "prefers the project's configured Codex instance when several accounts share one history store",
    () =>
      Effect.gen(function* () {
        const preferredInstanceId = ProviderInstanceId.make("codex-preferred-account");
        const sharedImport: ProviderThreadImportShape = {
          scan: () => Effect.succeed([sourceCandidate()]),
          read: () => Effect.succeed(sourceTranscript()),
        };
        const firstProvider = makeProvider(sharedImport, {
          providerInstanceId: instanceId,
          continuationKey: "codex:shared-home",
        });
        const preferredProvider = makeProvider(sharedImport, {
          providerInstanceId: preferredInstanceId,
          continuationKey: "codex:shared-home",
        });
        const preferredProject = {
          ...project,
          defaultModelSelection: {
            instanceId: preferredInstanceId,
            model: "gpt-5.6-codex",
          },
        } satisfies OrchestrationProjectShell;
        const harness = makeHarness({
          candidates: [sourceCandidate()],
          read: () => Effect.succeed(sourceTranscript()),
          providers: [firstProvider, preferredProvider],
          project: preferredProject,
        });

        const scan = yield* harness.service.scan({ projectId });
        expect(scan.candidates).toHaveLength(1);
        expect(scan.candidates[0]?.providerInstanceId).toBe(preferredInstanceId);

        const candidateId = scan.candidates[0]!.candidateId;
        const commit = yield* harness.service.commit({
          projectId,
          candidateIds: [candidateId],
          runtimeMode: "full-access",
          interactionMode: "default",
        });
        expect(commit.results[0]?.status).toBe("imported");
        expect(harness.bindings[0]?.providerInstanceId).toBe(preferredInstanceId);
        expect(harness.commands[0]?.type).toBe("thread.import");
        if (harness.commands[0]?.type === "thread.import") {
          expect(harness.commands[0].modelSelection.instanceId).toBe(preferredInstanceId);
        }
      }),
  );
'''
p.write_text(text[:-4] + new_test + "});\n", encoding="utf-8")

Path("apps/server/src/orchestration/decider.threadImport.test.ts").write_text(
    r'''import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";

const CREATED_AT = "2026-07-01T10:00:00.000Z";
const MESSAGE_AT = "2026-07-01T10:01:00.000Z";
const UPDATED_AT = "2026-07-01T10:02:00.000Z";

it.layer(NodeServices.layer)("thread import decider", (it) => {
  it.effect("pins imported historical history active without replacing its historical timestamps", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("project-thread-import-decider");
      const threadId = ThreadId.make("thread-thread-import-decider");
      const readModel: OrchestrationReadModel = {
        snapshotSequence: 0,
        projects: [
          {
            id: projectId,
            title: "Imported project",
            workspaceRoot: "/workspace/imported",
            defaultModelSelection: null,
            defaultThreadEnvMode: null,
            faviconPath: null,
            scripts: [],
            createdAt: CREATED_AT,
            updatedAt: CREATED_AT,
            deletedAt: null,
          },
        ],
        threads: [],
        updatedAt: CREATED_AT,
      };

      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.import",
          commandId: CommandId.make("cmd-thread-import-active"),
          threadId,
          projectId,
          title: "Historical Codex chat",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex-account"),
            model: "gpt-5.6-codex",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          messages: [
            {
              id: MessageId.make("historical-user-message"),
              role: "user",
              text: "Historical user message",
              createdAt: MESSAGE_AT,
            },
          ],
          createdAt: CREATED_AT,
          updatedAt: UPDATED_AT,
        },
        readModel,
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events.map((event) => event.type)).toEqual([
        "thread.created",
        "thread.message-sent",
        "thread.meta-updated",
        "thread.unsettled",
      ]);

      let projected = readModel;
      let sequence = 0;
      for (const event of events) {
        sequence += 1;
        projected = yield* projectEvent(projected, { ...event, sequence });
      }
      expect(projected.threads[0]).toMatchObject({
        id: threadId,
        settledOverride: "active",
        settledAt: null,
        unsettledAt: UPDATED_AT,
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
      });
    }),
  );
});
''',
    encoding="utf-8",
)

print("Applied importer smoke fixes and regression coverage.")
