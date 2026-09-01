import { assert, it } from "@effect/vitest";

import {
  resolveWindowsDesktopProfilePaths,
  selectOfficialProfileSource,
  shouldSkipDesktopProfilePath,
} from "./migrate-windows-desktop-profile.ts";

it("derives official, Hardened, and backup paths from Windows APPDATA", () => {
  const appData = "C:\\Users\\alice\\AppData\\Roaming";

  assert.deepStrictEqual(resolveWindowsDesktopProfilePaths(appData), {
    officialLegacy: `${appData}\\T3 Code (Alpha)`,
    officialModern: `${appData}\\t3code`,
    hardened: `${appData}\\t3code-hardened`,
    backupParent: `${appData}\\T3 Code Hardened Migration Backups`,
  });
});

it("matches the official runtime's legacy-first profile precedence", () => {
  assert.equal(selectOfficialProfileSource({ legacyExists: true, modernExists: true }), "legacy");
  assert.equal(selectOfficialProfileSource({ legacyExists: false, modernExists: true }), "modern");
  assert.equal(
    selectOfficialProfileSource({
      legacyExists: true,
      modernExists: true,
      requested: "modern",
    }),
    "modern",
  );
  assert.isUndefined(selectOfficialProfileSource({ legacyExists: false, modernExists: false }));
});

it("excludes Codex state, transient Chromium state, and lock artifacts", () => {
  for (const path of [
    ".codex\\state.sqlite",
    ".codex-a2\\goals.sqlite-wal",
    ".codex-a3\\auth.json",
    "Cache\\entry",
    "GPUCache\\data_0",
    "SingletonLock",
    "Network\\Cookies-journal",
    "state.sqlite.shm",
  ]) {
    assert.isTrue(shouldSkipDesktopProfilePath(path), path);
  }

  assert.isFalse(shouldSkipDesktopProfilePath("Network\\Cookies"));
  assert.isFalse(shouldSkipDesktopProfilePath("Local Storage\\leveldb\\000003.ldb"));
});
