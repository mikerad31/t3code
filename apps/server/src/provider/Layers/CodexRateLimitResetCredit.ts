import type { CodexSettings, ProviderRateLimitResetCreditOutcome } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as CodexClient from "effect-codex-app-server/client";
import * as CodexErrors from "effect-codex-app-server/errors";

import { resolveSpawnCommand } from "@t3tools/shared/shell";
import { expandHomePath } from "../../pathExpansion.ts";
import packageJson from "../../../package.json" with { type: "json" };
import { codexAppServerArgs, resolveCodexLaunchArgs } from "./codexLaunchArgs.ts";

const FORCE_KILL_AFTER = "2 seconds" as const;

/**
 * Redeem one banked Codex rate-limit reset through the official app-server
 * protocol. The caller passes one provider instance's already-resolved
 * settings/environment, so CODEX_HOME stays pinned to that exact account.
 *
 * `creditId` is intentionally omitted. The Codex protocol explicitly allows
 * the backend to select the next available credit, while `idempotencyKey`
 * identifies this single logical redemption attempt.
 */
export const consumeCodexRateLimitResetCredit = Effect.fn("consumeCodexRateLimitResetCredit")(
  function* (input: {
    readonly settings: CodexSettings;
    readonly environment?: NodeJS.ProcessEnv;
    readonly idempotencyKey: string;
  }) {
    return yield* Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const resolvedHomePath = input.settings.homePath
        ? expandHomePath(input.settings.homePath)
        : undefined;
      const environment = {
        ...input.environment,
        ...(resolvedHomePath ? { CODEX_HOME: resolvedHomePath } : {}),
      };
      const launchArgs = resolveCodexLaunchArgs(input.settings.launchArgs, environment);
      const spawnCommand = yield* resolveSpawnCommand(
        input.settings.binaryPath,
        codexAppServerArgs(launchArgs),
        { env: environment, extendEnv: true },
      );
      const child = yield* spawner
        .spawn(
          ChildProcess.make(spawnCommand.command, spawnCommand.args, {
            cwd: process.cwd(),
            env: environment,
            extendEnv: true,
            forceKillAfter: FORCE_KILL_AFTER,
            shell: spawnCommand.shell,
          }),
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new CodexErrors.CodexAppServerSpawnError({
                command: `${input.settings.binaryPath} app-server`,
                cause,
              }),
          ),
        );

      const clientContext = yield* Layer.build(CodexClient.layerChildProcess(child));
      const client = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(
        Effect.provide(clientContext),
      );

      yield* client.request("initialize", {
        clientInfo: {
          name: "t3code_desktop",
          title: "T3 Code Desktop",
          version: packageJson.version,
        },
        capabilities: { experimentalApi: true },
      });
      yield* client.notify("initialized", undefined);

      const response = yield* client.request("account/rateLimitResetCredit/consume", {
        idempotencyKey: input.idempotencyKey,
      });
      return response.outcome satisfies ProviderRateLimitResetCreditOutcome;
    }).pipe(Effect.scoped);
  },
);
