// @effect-diagnostics nodeBuiltinImport:off
import * as NodeSqlite from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { CodexSettings } from "@t3tools/contracts";
import {
  codexHomeProcessEnvironment,
  materializeCodexShadowHome,
  resolveCodexHomeLayout,
} from "./CodexHomeLayout.ts";

const decodeCodexSettings = Schema.decodeSync(CodexSettings);

it.layer(NodeServices.layer)("CodexHomeLayout sqlite family safety", (it) => {
  it.effect("routes SQLite families directly to the shared home", () =>
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

      const layout = yield* resolveCodexHomeLayout(
        decodeCodexSettings({
          homePath: sharedHome,
          shadowHomePath: shadowHome,
        }),
      );
      yield* materializeCodexShadowHome(layout);

      const environment = codexHomeProcessEnvironment(layout, {
        CODEX_SQLITE_HOME: shadowHome,
      });
      expect(environment.CODEX_SQLITE_HOME).toBe(sharedHome);

      const familyName = "future_state_42.sqlite";
      const sharedDatabasePath = path.join(sharedHome, familyName);
      const database = new NodeSqlite.DatabaseSync(sharedDatabasePath);
      try {
        database.exec("PRAGMA journal_mode=WAL");
        database.exec("CREATE TABLE safety_test (value TEXT NOT NULL)");
        database.exec("INSERT INTO safety_test (value) VALUES ('shared')");
        database.prepare("SELECT value FROM safety_test").get();

        expect(yield* fileSystem.exists(sharedDatabasePath)).toBe(true);
        expect(yield* fileSystem.exists(`${sharedDatabasePath}-wal`)).toBe(true);
        expect(yield* fileSystem.exists(`${sharedDatabasePath}-shm`)).toBe(true);
        expect(yield* fileSystem.exists(path.join(shadowHome, familyName))).toBe(false);
        expect(yield* fileSystem.exists(path.join(shadowHome, `${familyName}-wal`))).toBe(false);
        expect(yield* fileSystem.exists(path.join(shadowHome, `${familyName}-shm`))).toBe(false);
      } finally {
        database.close();
      }
    }),
  );

  it.effect("retires T3-owned SQLite symlinks without deleting ordinary shadow sidecars", () =>
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

      const familyName = "renamed_store_73.sqlite";
      const sharedDatabasePath = path.join(sharedHome, familyName);
      const shadowDatabasePath = path.join(shadowHome, familyName);
      const shadowWalPath = `${shadowDatabasePath}-wal`;
      const shadowShmPath = `${shadowDatabasePath}-shm`;
      yield* fileSystem.writeFileString(sharedDatabasePath, "shared-db\n");
      yield* fileSystem.symlink(sharedDatabasePath, shadowDatabasePath);
      yield* fileSystem.writeFileString(shadowWalPath, "preserve-wal\n");
      yield* fileSystem.writeFileString(shadowShmPath, "preserve-shm\n");

      const layout = yield* resolveCodexHomeLayout(
        decodeCodexSettings({
          homePath: sharedHome,
          shadowHomePath: shadowHome,
        }),
      );
      yield* materializeCodexShadowHome(layout);

      expect(yield* fileSystem.exists(shadowDatabasePath)).toBe(false);
      expect(yield* fileSystem.readFileString(shadowWalPath)).toBe("preserve-wal\n");
      expect(yield* fileSystem.readFileString(shadowShmPath)).toBe("preserve-shm\n");
      expect(yield* fileSystem.readFileString(sharedDatabasePath)).toBe("shared-db\n");
    }),
  );

  it.effect("does not materialize top-level SQLite-family links for arbitrary database names", () =>
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

      const sqliteEntries = [
        "future.sqlite",
        "future.sqlite-wal",
        "future.sqlite-shm",
        "renamed.sqlite3",
        "generic.db",
        "generic.db-journal",
      ] as const;
      for (const entryName of sqliteEntries) {
        yield* fileSystem.writeFileString(
          path.join(sharedHome, entryName),
          `shared:${entryName}\n`,
        );
      }

      const layout = yield* resolveCodexHomeLayout(
        decodeCodexSettings({
          homePath: sharedHome,
          shadowHomePath: shadowHome,
        }),
      );
      yield* materializeCodexShadowHome(layout);

      for (const entryName of sqliteEntries) {
        expect(yield* fileSystem.exists(path.join(shadowHome, entryName))).toBe(false);
      }
    }),
  );

  it.effect("does not override SQLite routing for a direct Codex home", () =>
    Effect.gen(function* () {
      const sharedHome = yield* FileSystem.FileSystem.pipe(
        Effect.flatMap((fileSystem) =>
          fileSystem.makeTempDirectoryScoped({ prefix: "t3code-codex-direct-" }),
        ),
      );
      const layout = yield* resolveCodexHomeLayout(
        decodeCodexSettings({
          homePath: sharedHome,
        }),
      );
      const environment = { CODEX_SQLITE_HOME: "user-specified-sqlite-home" };

      expect(codexHomeProcessEnvironment(layout, environment)).toBe(environment);
    }),
  );
});
