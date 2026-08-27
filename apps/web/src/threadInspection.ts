import {
  requestOlderThreadTurns,
  threadHasOlderTurns,
} from "@t3tools/client-runtime/state/threads";
import type { OrchestrationThread, ScopedThreadRef } from "@t3tools/contracts";
import * as Option from "effect/Option";

import { readThreadDetail } from "./state/entities";
import { readEnvironmentThread } from "./state/threads";

const HISTORY_POLL_INTERVAL_MS = 75;
const HISTORY_MAX_POLL_STEPS = 800;
const DOWNLOAD_OBJECT_URL_REVOKE_DELAY_MS = 30_000;

function waitForHistoryProgress(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, HISTORY_POLL_INTERVAL_MS));
}

/**
 * Fully hydrates a paginated T3 thread before copy/export. The timeline normally
 * loads only the newest turns, so exporting the current detail snapshot without
 * this step would silently truncate long conversations.
 */
export async function loadCompleteThread(ref: ScopedThreadRef): Promise<OrchestrationThread> {
  for (let step = 0; step < HISTORY_MAX_POLL_STEPS; step += 1) {
    const state = readEnvironmentThread(ref.environmentId, ref.threadId);
    if (!threadHasOlderTurns(state)) {
      const thread = readThreadDetail(ref);
      if (thread === null) {
        throw new Error("Thread details are not available yet.");
      }
      return thread;
    }

    const page = Option.getOrUndefined(state.page);
    if (page === undefined) {
      throw new Error("Thread pagination state disappeared while loading history.");
    }

    if (!page.loadingOlder) {
      const started = requestOlderThreadTurns(ref.environmentId, ref.threadId);
      if (!started) {
        throw new Error("Could not request the next page of thread history.");
      }
    }

    await waitForHistoryProgress();
  }

  throw new Error("Timed out while loading the complete thread history.");
}

export function downloadTextFile(input: {
  readonly filename: string;
  readonly text: string;
  readonly mimeType: string;
}): void {
  const blob = new Blob([input.text], { type: input.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = input.filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Keep the object URL alive long enough for browsers/WebViews that consume
  // the click asynchronously; immediate revocation can abort the download.
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_OBJECT_URL_REVOKE_DELAY_MS);
}