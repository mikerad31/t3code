from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        print(f"{label}: already applied")
        return text
    if old not in text:
        raise SystemExit(f"{label}: expected source block not found")
    print(f"{label}: applied")
    return text.replace(old, new, 1)


home_path = Path("apps/server/src/provider/Drivers/CodexHomeLayout.ts")
home = home_path.read_text()

home = replace_once(
    home,
    '''const REPLACEABLE_SHARED_RUNTIME_DIRECTORIES = new Set(["mcp-oauth-locks"]);\nconst REPLACEABLE_SHARED_RUNTIME_FILE_SUFFIXES = [".sqlite-shm", ".sqlite-wal"] as const;\n\nfunction isReplaceableSharedRuntimeEntry(entryName: string): boolean {\n  return (\n    REPLACEABLE_SHARED_RUNTIME_DIRECTORIES.has(entryName) ||\n    REPLACEABLE_SHARED_RUNTIME_FILE_SUFFIXES.some((suffix) => entryName.endsWith(suffix))\n  );\n}\n''',
    '''const REPLACEABLE_SHARED_RUNTIME_DIRECTORIES = new Set(["mcp-oauth-locks"]);\nconst SQLITE_DATABASE_SUFFIXES = [".sqlite", ".sqlite3", ".db", ".db3"] as const;\nconst SQLITE_SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"] as const;\n\nfunction isReplaceableSharedRuntimeEntry(entryName: string): boolean {\n  return REPLACEABLE_SHARED_RUNTIME_DIRECTORIES.has(entryName);\n}\n\nfunction isTopLevelSqliteFamilyEntry(entryName: string): boolean {\n  let databaseName = entryName.toLowerCase();\n  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {\n    if (databaseName.endsWith(suffix)) {\n      databaseName = databaseName.slice(0, -suffix.length);\n      break;\n    }\n  }\n  return SQLITE_DATABASE_SUFFIXES.some((suffix) => databaseName.endsWith(suffix));\n}\n''',
    "generic sqlite family classifier",
)

home = replace_once(
    home,
    '''});\n\nconst CodexShadowHomeContext = {\n''',
    '''});\n\n/**\n * Keep per-account authentication in CODEX_HOME while routing every SQLite\n * database family through one canonical directory. SQLite derives WAL/SHM\n * filenames from the database pathname it opens, so file-level DB symlinks can\n * otherwise split one family across the shared and shadow homes.\n */\nexport function codexHomeProcessEnvironment(\n  layout: CodexHomeLayout,\n  environment: NodeJS.ProcessEnv,\n): NodeJS.ProcessEnv {\n  if (layout.mode !== "authOverlay") return environment;\n  return {\n    ...environment,\n    CODEX_SQLITE_HOME: layout.sharedHomePath,\n  };\n}\n\nconst CodexShadowHomeContext = {\n''',
    "sqlite home process environment",
)

home = replace_once(
    home,
    '''  }\n});\n\nconst ensureSymlink = Effect.fn("CodexHomeLayout.ensureSymlink")(function* (input: {\n''',
    '''  }\n});\n\nconst retireLegacySharedSqliteSymlink = Effect.fn(\n  "CodexHomeLayout.retireLegacySharedSqliteSymlink",\n)(function* (input: {\n  readonly fileSystem: FileSystem.FileSystem;\n  readonly sharedHomePath: string;\n  readonly effectiveHomePath: string;\n  readonly entryName: string;\n}): Effect.fn.Return<void, CodexShadowHomeError, Path.Path> {\n  const path = yield* Path.Path;\n  const shadowPath = path.join(input.effectiveHomePath, input.entryName);\n  const expectedTarget = path.join(input.sharedHomePath, input.entryName);\n  const state = yield* readLinkState({\n    ...input,\n    linkPath: shadowPath,\n  });\n  if (state._tag !== "Symlink") return;\n\n  const resolvedExisting = path.resolve(path.dirname(shadowPath), state.target);\n  if (resolvedExisting !== expectedTarget) return;\n\n  yield* input.fileSystem.remove(shadowPath).pipe(\n    Effect.catchTags({\n      PlatformError: (cause) =>\n        new CodexShadowHomeFileSystemError({\n          sharedHomePath: input.sharedHomePath,\n          effectiveHomePath: input.effectiveHomePath,\n          operation: "remove",\n          path: shadowPath,\n          entryName: input.entryName,\n          cause,\n        }),\n    }),\n  );\n});\n\nconst ensureSymlink = Effect.fn("CodexHomeLayout.ensureSymlink")(function* (input: {\n''',
    "retire legacy sqlite symlinks",
)

home = replace_once(
    home,
    '''  const entries = new Set<string>(KNOWN_SHARED_DIRECTORIES);\n  for (const entryName of sharedEntryNames) {\n    if (!PRIVATE_ENTRY_NAMES.has(entryName) && !SHADOW_LOCAL_ENTRY_NAMES.has(entryName)) {\n      entries.add(entryName);\n    }\n  }\n''',
    '''  const shadowEntryNames = yield* fileSystem.readDirectory(effectiveHomePath).pipe(\n    Effect.catchTags({\n      PlatformError: (cause) =>\n        new CodexShadowHomeFileSystemError({\n          sharedHomePath: layout.sharedHomePath,\n          effectiveHomePath,\n          operation: "readDirectory",\n          path: effectiveHomePath,\n          cause,\n        }),\n    }),\n  );\n\n  const sqliteFamilyEntries = new Set(\n    [...sharedEntryNames, ...shadowEntryNames].filter(isTopLevelSqliteFamilyEntry),\n  );\n  yield* Effect.forEach(\n    sqliteFamilyEntries,\n    (entryName) =>\n      retireLegacySharedSqliteSymlink({\n        fileSystem,\n        sharedHomePath: layout.sharedHomePath,\n        effectiveHomePath,\n        entryName,\n      }),\n    { discard: true },\n  );\n\n  const entries = new Set<string>(KNOWN_SHARED_DIRECTORIES);\n  for (const entryName of sharedEntryNames) {\n    if (\n      !PRIVATE_ENTRY_NAMES.has(entryName) &&\n      !SHADOW_LOCAL_ENTRY_NAMES.has(entryName) &&\n      !isTopLevelSqliteFamilyEntry(entryName)\n    ) {\n      entries.add(entryName);\n    }\n  }\n''',
    "sqlite family reconciliation",
)

home_path.write_text(home)


driver_path = Path("apps/server/src/provider/Drivers/CodexDriver.ts")
driver = driver_path.read_text()
driver = replace_once(
    driver,
    '''import {\n  codexContinuationIdentity,\n  materializeCodexShadowHome,\n  resolveCodexHomeLayout,\n} from "./CodexHomeLayout.ts";\n''',
    '''import {\n  codexContinuationIdentity,\n  codexHomeProcessEnvironment,\n  materializeCodexShadowHome,\n  resolveCodexHomeLayout,\n} from "./CodexHomeLayout.ts";\n''',
    "driver sqlite environment import",
)
driver = replace_once(
    driver,
    '''      const processEnv = mergeProviderInstanceEnvironment(environment);\n      const homeLayout = yield* resolveCodexHomeLayout(config);\n''',
    '''      const baseProcessEnv = mergeProviderInstanceEnvironment(environment);\n      const homeLayout = yield* resolveCodexHomeLayout(config);\n      const processEnv = codexHomeProcessEnvironment(homeLayout, baseProcessEnv);\n''',
    "driver canonical sqlite environment",
)
driver_path.write_text(driver)


sidecar_test_path = Path("apps/server/src/provider/Drivers/CodexHomeLayout.sidecar.test.ts")
sidecar_test_path.write_text(r'''// @effect-diagnostics nodeBuiltinImport:off
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
      const secondConnection = new NodeSqlite.DatabaseSync(sharedDatabasePath);
      try {
        database.exec("PRAGMA journal_mode=WAL");
        database.exec("CREATE TABLE safety_test (value TEXT NOT NULL)");
        database.exec("INSERT INTO safety_test (value) VALUES ('shared')");
        secondConnection.prepare("SELECT value FROM safety_test").get();

        expect(yield* fileSystem.exists(sharedDatabasePath)).toBe(true);
        expect(yield* fileSystem.exists(`${sharedDatabasePath}-wal`)).toBe(true);
        expect(yield* fileSystem.exists(`${sharedDatabasePath}-shm`)).toBe(true);
        expect(yield* fileSystem.exists(path.join(shadowHome, familyName))).toBe(false);
        expect(yield* fileSystem.exists(path.join(shadowHome, `${familyName}-wal`))).toBe(false);
        expect(yield* fileSystem.exists(path.join(shadowHome, `${familyName}-shm`))).toBe(false);
      } finally {
        secondConnection.close();
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
        yield* fileSystem.writeFileString(path.join(sharedHome, entryName), `shared:${entryName}\n`);
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
''')

print("Codex shadow SQLite patch prepared")
