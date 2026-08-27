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
import { describe, expect, it } from "vite-plus/test";

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

function makeProvider(threadImport: ProviderThreadImportShape): ProviderInstance {
  const snapshotValue = {
    models: [{ slug: "gpt-5.6-codex", isDefault: true }],
  } as unknown as ServerProvider;
  return {
    instanceId,
    driverKind,
    continuationIdentity: {
      driverKind,
      continuationKey: "codex:test-home",
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
}) {
  let importedThread: OrchestrationThreadShell | null = null;
  const commands: OrchestrationCommand[] = [];
  const bindings: ProviderRuntimeBinding[] = [];

  const projection = {
    getProjectShellById: () => Effect.succeed(Option.some(project)),
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
    listInstances: Effect.succeed([provider]),
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
  it("preserves historical timestamps, saves resume state, and is deterministic/idempotent", async () => {
    const transcript = sourceTranscript();
    const harness = makeHarness({
      candidates: [sourceCandidate()],
      read: () => Effect.succeed(transcript),
    });

    const firstScan = await Effect.runPromise(harness.service.scan({ projectId }));
    const secondScan = await Effect.runPromise(harness.service.scan({ projectId }));
    expect(firstScan.candidates).toHaveLength(1);
    expect(secondScan.candidates[0]?.candidateId).toBe(firstScan.candidates[0]?.candidateId);

    const candidateId = firstScan.candidates[0]!.candidateId;
    const firstCommit = await Effect.runPromise(
      harness.service.commit({
        projectId,
        candidateIds: [candidateId],
        runtimeMode: "full-access",
        interactionMode: "default",
      }),
    );

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

    const postImportScan = await Effect.runPromise(harness.service.scan({ projectId }));
    expect(postImportScan.candidates[0]?.alreadyImported).toBe(true);

    const secondCommit = await Effect.runPromise(
      harness.service.commit({
        projectId,
        candidateIds: [candidateId],
        runtimeMode: "full-access",
        interactionMode: "default",
      }),
    );
    expect(secondCommit.results[0]?.status).toBe("already-imported");
    expect(harness.commands).toHaveLength(1);
    expect(harness.bindings).toHaveLength(1);
  });

  it("keeps the imported transcript when native resume binding cannot be persisted", async () => {
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
    const scan = await Effect.runPromise(harness.service.scan({ projectId }));
    const result = await Effect.runPromise(
      harness.service.commit({
        projectId,
        candidateIds: [scan.candidates[0]!.candidateId],
        runtimeMode: "full-access",
        interactionMode: "default",
      }),
    );

    expect(result.results[0]?.status).toBe("transcript-only");
    expect(result.results[0]?.warnings.join(" ")).toContain("resume state could not be saved");
    expect(harness.commands).toHaveLength(1);
  });

  it("repairs missing native resume state on retry without duplicating the transcript", async () => {
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

    const initialScan = await Effect.runPromise(harness.service.scan({ projectId }));
    const candidateId = initialScan.candidates[0]!.candidateId;
    const firstCommit = await Effect.runPromise(
      harness.service.commit({
        projectId,
        candidateIds: [candidateId],
        runtimeMode: "full-access",
        interactionMode: "default",
      }),
    );
    expect(firstCommit.results[0]?.status).toBe("transcript-only");
    expect(harness.commands).toHaveLength(1);
    expect(harness.bindings).toHaveLength(0);

    const repairScan = await Effect.runPromise(harness.service.scan({ projectId }));
    expect(repairScan.candidates[0]).toMatchObject({
      candidateId,
      alreadyImported: false,
      canResume: false,
    });
    expect(repairScan.candidates[0]?.warnings.join(" ")).toContain("needs repair");

    rejectBinding = false;
    const repairCommit = await Effect.runPromise(
      harness.service.commit({
        projectId,
        candidateIds: [candidateId],
        runtimeMode: "full-access",
        interactionMode: "default",
      }),
    );
    expect(repairCommit.results[0]?.status).toBe("already-imported");
    expect(repairCommit.results[0]?.importedMessageCount).toBe(0);
    expect(repairCommit.results[0]?.warnings.join(" ")).toContain("was restored");
    expect(harness.commands).toHaveLength(1);
    expect(harness.bindings).toHaveLength(1);

    const repairedScan = await Effect.runPromise(harness.service.scan({ projectId }));
    expect(repairedScan.candidates[0]).toMatchObject({
      candidateId,
      alreadyImported: true,
      canResume: true,
    });
  });

  it("surfaces a total Codex scan failure instead of reporting empty history", async () => {
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

    await expect(Effect.runPromise(harness.service.scan({ projectId }))).rejects.toMatchObject({
      code: "source-unavailable",
      message: "simulated Codex history scan failure",
    });
  });

  it("isolates transcript read failures so another selected conversation can still import", async () => {
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
    const scan = await Effect.runPromise(harness.service.scan({ projectId }));
    expect(scan.candidates).toHaveLength(2);

    const result = await Effect.runPromise(
      harness.service.commit({
        projectId,
        candidateIds: scan.candidates.map((candidate) => candidate.candidateId),
        runtimeMode: "full-access",
        interactionMode: "default",
      }),
    );

    expect(result.results.map((item) => item.status)).toEqual(["failed", "imported"]);
    expect(result.results[0]?.error).toContain("simulated unreadable transcript");
    expect(harness.commands).toHaveLength(1);
  });
});
