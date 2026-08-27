import {
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
  it.effect(
    "pins imported historical history active without replacing its historical timestamps",
    () =>
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
