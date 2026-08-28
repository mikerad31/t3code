import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { CodexSettings } from "@t3tools/contracts";
import { materializeCodexShadowHome, resolveCodexHomeLayout } from "./CodexHomeLayout.ts";

const decodeCodexSettings = Schema.decodeSync(CodexSettings);

it.layer(NodeServices.layer)("CodexHomeLayout sqlite sidecar repair", (it) => {
  it.effect("replaces Codex-created real sqlite sidecars with shared-home symlinks", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const sharedHome = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-codex-shared-",
      });
      const shadowRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-codex-shadow-root-",
      });
      const shadowHome = path.join(shadowRoot, "shadow");
      yield* fileSystem.makeDirectory(shadowHome, { recursive: true });
      yield* fileSystem.writeFileString(path.join(shadowHome, "auth.json"), '{"shadow":true}\n');

      for (const entryName of ["goals_1.sqlite-shm", "goals_1.sqlite-wal"] as const) {
        yield* fileSystem.writeFileString(path.join(sharedHome, entryName), "shared-runtime\n");
        yield* fileSystem.writeFileString(path.join(shadowHome, entryName), "stale-shadow-runtime\n");
      }

      const layout = yield* resolveCodexHomeLayout(
        decodeCodexSettings({
          homePath: sharedHome,
          shadowHomePath: shadowHome,
        }),
      );

      yield* materializeCodexShadowHome(layout);

      for (const entryName of ["goals_1.sqlite-shm", "goals_1.sqlite-wal"] as const) {
        const linkTarget = yield* fileSystem.readLink(path.join(shadowHome, entryName));
        expect(linkTarget).toBe(path.join(sharedHome, entryName));
      }

      const authContents = yield* fileSystem.readFileString(path.join(shadowHome, "auth.json"));
      expect(authContents).toContain("shadow");
    }),
  );
});
