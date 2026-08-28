import {
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type OrchestrationCommand,
  type OrchestrationProjectShell,
  type OrchestrationReadModel,
  type OrchestrationThreadShell,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { it } from "@effect/vitest";
import { describe, expect } from "vite-plus/test";

import type { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import type { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderValidationError } from "../provider/Errors.ts";
import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import {
  ProviderThreadImportError,
  type ProviderThreadImportCandidate,
  type ProviderThreadImportShape,
  type ProviderThreadImportTranscript,
} from "../provider/ProviderThreadImport.ts";
import type { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import type {
  ProviderRuntimeBinding,
  ProviderSessionDirectory,
} from "../provider/Services/ProviderSessionDirectory.ts";
import { makeThreadImportService } from "./ThreadImportService.ts";

const projectId = ProjectId.make("project-import-test");
const instanceId = ProviderInstanceId.make("codex-import-test");
const driverKind = ProviderDriverKind.make("codex");
const project = {
  id: projectId,
  workspaceRoot: "/workspace/project",
  defaultModelSelection: null,
} as OrchestrationProjectShell;

const sourceCandidate = (overrides: Partial<ProviderThreadImportCandidate> = {}) => ({
  externalThreadId: "codex-thread-1",
  title: "Persisted Codex conversation",
  preview: "First persisted message",
  sourceCwd: project.workspaceRoot,
  createdAt: "2026-08-20T10:00:00.000Z",
  updatedAt: "2026-08-20T10:05:00.000Z",
  archived: false,
  warnings: [],
  ...overrides,
});

const sourceTranscript = (
  overrides: Partial<ProviderThreadImportTranscript> = {},
): ProviderThreadImportTranscript => ({
  ...sourceCandidate(),
  messages: [
    {
      role: "user",
      text: "Keep this timestamp exactly.",
      createdAt: "2026-08-20T10:01:00.000Z",
    },
    {
      role: "assistant",
      text: "Historical reply.",
      createdAt: "2026-08-20T10:02:00.000Z",
    },
  ],
  resumeCursor: { threadId: "codex-thread-1", turn: 7 },
  ...overrides,
});

function makeProvider(
  threadImport: ProviderThreadImportShape,
  options: {
    readonly providerInstanceId?: ProviderInstanceId;
    readonly continuationKey?: string;
  } = {},
): ProviderInstance {
  const snapshotValue = {
    models: [{ slug: "gpt-5.6-codex", isDefault: true }],
  } as unknown as ServerProvider;
  const providerInstanceId = options.providerInstanceId ?? instanceId;
  return {
    instanceId: providerInstanceId,
    driverKind,
    continuationIdentity: {
      driverKind,
      continuationKey: options.continuationKey ?? "codex:test-home",
    },
    displayName: "Codex Test",
    enabled: true,
    snapshot: {
      maintenanceCapabilities: {} as ProviderInstance["snapshot"]["maintenanceCapabilities"],
      getSnapshot: Effect.succeed(snapshotValue),
      refresh: Effect.succeed(snapshotValue),
      streamChanges: Stream.empty,
    },
    adapter: {} as ProviderInstance["adapter"],
    textGeneration: {} as ProviderInstance["textGeneration"],
    threadImport,
  };
}

function makeHarness(options: {
  readonly candidates: ReadonlyArray<ProviderThreadImportCandidate>;
  readonly scan?: ProviderThreadImportShape["scan"];
  readonly read: ProviderThreadImportShape["read"];
  readonly sessionUpsert?: ProviderSessionDirectory["Service"]["upsert"];
  readonly providers?: ReadonlyArray<ProviderInstance>;
  readonly project?: OrchestrationProjectShell;
}) {
  let importedThread: OrchestrationThreadShell | null = null;
  const commands: OrchestrationCommand[] = [];
  const bindings: ProviderRuntimeBinding[] = [];

  const projection = {
    getProjectShellById: () => Effect.succeed(Option.some(options.project ?? project)),
    getSnapshot: () =>
      Effect.succeed({
        threads: importedThread === null ? [] : [importedThread],
      } as unknown as OrchestrationReadModel),
    getThreadShellById: (threadId: OrchestrationThreadShell["id"]) =>
      Effect.succeed(
        importedThread !== null && String(importedThread.id) === String(threadId)
          ? Option.some(importedThread)
          : Option.none(),
      ),
  } as unknown as ProjectionSnapshotQuery["Service"];

  const engine = {
    dispatch: (command: OrchestrationCommand) => {
      commands.push(command);
      if (command.type === "thread.import") {
        importedThread = {
          id: command.threadId,
          projectId: command.projectId,
          modelSelection: command.modelSelection,
          runtimeMode: command.runtimeMode,
        } as OrchestrationThreadShell;
      }
      return Effect.succeed({ sequence: commands.length });
    },
    readEvents: () => Stream.empty,
    streamDomainEvents: Stream.empty,
    latestSequence: Effect.succeed(0),
  } as OrchestrationEngineService["Service"];

  const provider = makeProvider({
    scan: options.scan ?? (() => Effect.succeed(options.candidates)),
    read: options.read,
  });
  const providerInstances = {
    getInstance: () => Effect.succeed(provider),
    listInstances: Effect.succeed(options.providers ?? [provider]),
    listUnavailable: Effect.succeed([]),
    streamChanges: Stream.empty,
    subscribeChanges: Effect.die("not used by thread import tests"),
  } as ProviderInstanceRegistry["Service"];

  const providerSessions = {
    upsert: (binding: ProviderRuntimeBinding) =>
      (options.sessionUpsert?.(binding) ?? Effect.void).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            bindings.push(binding);
          }),
        ),
      ),
    getProvider: () => Effect.die("not used by thread import tests"),
    getBinding: (threadId: OrchestrationThreadShell["id"]) => {
      const binding = bindings.findLast(
        (candidate) => String(candidate.threadId) === String(threadId),
      );
      return Effect.succeed(binding === undefined ? Option.none() : Option.some(binding));
    },
    listThreadIds: () => Effect.succeed([]),
    listBindings: () => Effect.succeed([]),
  } as ProviderSessionDirectory["Service"];

  return {
    service: makeThreadImportService({
      projection,
      engine,
      providerInstances,
      providerSessions,
    }),
    commands,
    bindings,
  };
}

describe("ThreadImportService", () => {
  it.effect(
    "preserves historical timestamps, saves resume state, and is deterministic/idempotent",
    () =>
      Effect.gen(function* () {
        const transcript = sourceTranscript();
        const harness = makeHarness({
          candidates: [sourceCandidate()],
          read: () => Effect.succeed(transcript),
        });

        const firstScan = yield* harness.service.scan({ projectId });
        const secondScan = yield* harness.service.scan({ projectId });
        expect(firstScan.candidates).toHaveLength(1);
        expect(secondScan.candidates[0]?.candidateId).toBe(firstScan.candidates[0]?.candidateId);

        const candidateId = firstScan.candidates[0]!.candidateId;
        const firstCommit = yield* harness.service.commit({
          projectId,
          candidateIds: [candidateId],
          runtimeMode: "full-access",
          interactionMode: "default",
        });

        expect(firstCommit.results[0]).toMatchObject({
          candidateId,
          status: "imported",
          importedMessageCount: 2,
        });
        expect(harness.commands).toHaveLength(1);
        const command = harness.commands[0]!;
        expect(command.type).toBe("thread.import");
        if (command.type !== "thread.import") throw new Error("expected thread.import command");
        expect(command.createdAt).toBe(transcript.createdAt);
        expect(command.updatedAt).toBe(transcript.updatedAt);
        expect(command.messages.map((message) => message.createdAt)).toEqual(
          transcript.messages.map((message) => message.createdAt),
        );
        expect(harness.bindings).toHaveLength(1);
        expect(harness.bindings[0]).toMatchObject({
          threadId: command.threadId,
          provider: driverKind,
          providerInstanceId: instanceId,
          status: "stopped",
          resumeCursor: transcript.resumeCursor,
          runtimeMode: "full-access",
          runtimePayload: {
            cwd: project.workspaceRoot,
          },
        });

        const postImportScan = yield* harness.service.scan({ projectId });
        expect(postImportScan.candidates[0]?.alreadyImported).toBe(true);

        const secondCommit = yield* harness.service.commit({
          projectId,
          candidateIds: [candidateId],
          runtimeMode: "full-access",
          interactionMode: "default",
        });
        expect(secondCommit.results[0]?.status).toBe("already-imported");
        expect(harness.commands).toHaveLength(1);
        expect(harness.bindings).toHaveLength(1);
      }),
  );

  it.effect("keeps the imported transcript when native resume binding cannot be persisted", () =>
    Effect.gen(function* () {
      const harness = makeHarness({
        candidates: [sourceCandidate()],
        read: () => Effect.succeed(sourceTranscript()),
        sessionUpsert: () =>
          Effect.fail(
            new ProviderValidationError({
              operation: "thread-import-resume-binding",
              issue: "simulated persistence rejection",
            }),
          ),
      });
      const scan = yield* harness.service.scan({ projectId });
      const result = yield* harness.service.commit({
        projectId,
        candidateIds: [scan.candidates[0]!.candidateId],
        runtimeMode: "full-access",
        interactionMode: "default",
      });

      expect(result.results[0]?.status).toBe("transcript-only");
      expect(result.results[0]?.warnings.join(" ")).toContain("resume state could not be saved");
      expect(harness.commands).toHaveLength(1);
    }),
  );

  it.effect("repairs missing native resume state on retry without duplicating the transcript", () =>
    Effect.gen(function* () {
      let rejectBinding = true;
      const harness = makeHarness({
        candidates: [sourceCandidate()],
        read: () => Effect.succeed(sourceTranscript()),
        sessionUpsert: () =>
          rejectBinding
            ? Effect.fail(
                new ProviderValidationError({
                  operation: "thread-import-resume-binding",
                  issue: "simulated persistence rejection",
                }),
              )
            : Effect.void,
      });

      const initialScan = yield* harness.service.scan({ projectId });
      const candidateId = initialScan.candidates[0]!.candidateId;
      const firstCommit = yield* harness.service.commit({
        projectId,
        candidateIds: [candidateId],
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      expect(firstCommit.results[0]?.status).toBe("transcript-only");
      expect(harness.commands).toHaveLength(1);
      expect(harness.bindings).toHaveLength(0);

      const repairScan = yield* harness.service.scan({ projectId });
      expect(repairScan.candidates[0]).toMatchObject({
        candidateId,
        alreadyImported: false,
        canResume: false,
      });
      expect(repairScan.candidates[0]?.warnings.join(" ")).toContain("needs repair");

      rejectBinding = false;
      const repairCommit = yield* harness.service.commit({
        projectId,
        candidateIds: [candidateId],
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      expect(repairCommit.results[0]?.status).toBe("already-imported");
      expect(repairCommit.results[0]?.importedMessageCount).toBe(0);
      expect(repairCommit.results[0]?.warnings.join(" ")).toContain("was restored");
      expect(harness.commands).toHaveLength(1);
      expect(harness.bindings).toHaveLength(1);

      const repairedScan = yield* harness.service.scan({ projectId });
      expect(repairedScan.candidates[0]).toMatchObject({
        candidateId,
        alreadyImported: true,
        canResume: true,
      });
    }),
  );

  it.effect("surfaces a total Codex scan failure instead of reporting empty history", () =>
    Effect.gen(function* () {
      const harness = makeHarness({
        candidates: [],
        scan: () =>
          Effect.fail(
            new ProviderThreadImportError({
              operation: "scan",
              detail: "simulated Codex history scan failure",
            }),
          ),
        read: () => Effect.succeed(sourceTranscript()),
      });

      const error = yield* harness.service.scan({ projectId }).pipe(Effect.flip);
      expect(error).toMatchObject({
        code: "source-unavailable",
        message: "simulated Codex history scan failure",
      });
    }),
  );

  it.effect(
    "isolates transcript read failures so another selected conversation can still import",
    () =>
      Effect.gen(function* () {
        const unreadable = sourceCandidate({
          externalThreadId: "codex-thread-broken",
          title: "Unreadable conversation",
          updatedAt: "2026-08-21T10:00:00.000Z",
        });
        const readable = sourceCandidate({
          externalThreadId: "codex-thread-good",
          title: "Readable conversation",
          updatedAt: "2026-08-20T10:00:00.000Z",
        });
        const harness = makeHarness({
          candidates: [unreadable, readable],
          read: ({ externalThreadId }) =>
            externalThreadId === unreadable.externalThreadId
              ? Effect.fail(
                  new ProviderThreadImportError({
                    operation: "read",
                    detail: "simulated unreadable transcript",
                  }),
                )
              : Effect.succeed(
                  sourceTranscript({
                    externalThreadId: readable.externalThreadId,
                    title: readable.title,
                  }),
                ),
        });
        const scan = yield* harness.service.scan({ projectId });
        expect(scan.candidates).toHaveLength(2);

        const result = yield* harness.service.commit({
          projectId,
          candidateIds: scan.candidates.map((candidate) => candidate.candidateId),
          runtimeMode: "full-access",
          interactionMode: "default",
        });

        expect(result.results.map((item) => item.status)).toEqual(["skipped", "imported"]);
        expect(result.results[0]?.error).toContain("simulated unreadable transcript");
        expect(harness.commands).toHaveLength(1);
      }),
  );

  it.effect("skips empty Codex transcripts without reporting a product failure", () =>
    Effect.gen(function* () {
      const harness = makeHarness({
        candidates: [sourceCandidate()],
        read: () => Effect.succeed(sourceTranscript({ messages: [] })),
      });
      const scan = yield* harness.service.scan({ projectId });
      const result = yield* harness.service.commit({
        projectId,
        candidateIds: [scan.candidates[0]!.candidateId],
        runtimeMode: "full-access",
        interactionMode: "default",
      });

      expect(result.results[0]).toMatchObject({
        status: "skipped",
        importedMessageCount: 0,
      });
      expect(result.results[0]?.error).toContain("no readable user or assistant messages");
      expect(harness.commands).toHaveLength(0);
    }),
  );

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
});
