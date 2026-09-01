#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalConsole:off - Standalone Windows migration boundary uses Node filesystem and process APIs directly.

import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadlinePromises from "node:readline/promises";

import {
  DESKTOP_DISTRIBUTION,
  OFFICIAL_DESKTOP_USER_DATA_DIRS,
} from "@t3tools/shared/desktopDistribution";

export type OfficialProfileSource = "legacy" | "modern";

export function resolveWindowsDesktopProfilePaths(appDataDirectory: string) {
  return {
    officialLegacy: NodePath.win32.join(appDataDirectory, OFFICIAL_DESKTOP_USER_DATA_DIRS.legacy),
    officialModern: NodePath.win32.join(appDataDirectory, OFFICIAL_DESKTOP_USER_DATA_DIRS.modern),
    hardened: NodePath.win32.join(appDataDirectory, DESKTOP_DISTRIBUTION.userDataDirName),
    backupParent: NodePath.win32.join(
      appDataDirectory,
      `${DESKTOP_DISTRIBUTION.productName} Migration Backups`,
    ),
  };
}

export function selectOfficialProfileSource(input: {
  readonly legacyExists: boolean;
  readonly modernExists: boolean;
  readonly requested?: OfficialProfileSource | undefined;
}): OfficialProfileSource | undefined {
  if (input.requested === "legacy") return input.legacyExists ? "legacy" : undefined;
  if (input.requested === "modern") return input.modernExists ? "modern" : undefined;
  // This is the same precedence used by the accepted official desktop runtime.
  if (input.legacyExists) return "legacy";
  return input.modernExists ? "modern" : undefined;
}

const EXCLUDED_DIRECTORY_NAMES = new Set([
  "cache",
  "code cache",
  "crashpad",
  "dawncache",
  "gpucache",
  "grshadercache",
  "logs",
  "shadercache",
  "temp",
  "tmp",
]);

export function shouldSkipDesktopProfilePath(relativePath: string): boolean {
  const parts = relativePath.split(/[\\/]+/u).filter(Boolean);
  if (parts.length === 0) return false;

  for (const part of parts) {
    const normalized = part.toLowerCase();
    if (normalized === ".codex" || normalized.startsWith(".codex-")) return true;
    if (EXCLUDED_DIRECTORY_NAMES.has(normalized)) return true;
  }

  const fileName = parts.at(-1)?.toLowerCase() ?? "";
  return (
    fileName.startsWith("singleton") ||
    fileName === "lockfile" ||
    fileName.endsWith(".lock") ||
    fileName.endsWith(".tmp") ||
    fileName.endsWith(".journal") ||
    fileName.endsWith("-journal") ||
    fileName.endsWith(".shm") ||
    fileName.endsWith(".wal")
  );
}

interface ProfilePlan {
  readonly directories: readonly string[];
  readonly files: readonly string[];
  readonly skipped: readonly string[];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await NodeFSP.access(path);
    return true;
  } catch {
    return false;
  }
}

async function assertRealDirectory(path: string, label: string): Promise<void> {
  const entry = await NodeFSP.lstat(path);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory, not a file, symlink, or junction: ${path}`);
  }
}

async function collectProfilePlan(root: string): Promise<ProfilePlan> {
  const directories: string[] = [];
  const files: string[] = [];
  const skipped: string[] = [];

  const visit = async (relativeDirectory: string): Promise<void> => {
    const absoluteDirectory = NodePath.join(root, relativeDirectory);
    const entries = await NodeFSP.readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const relativePath = NodePath.join(relativeDirectory, entry.name);
      if (shouldSkipDesktopProfilePath(relativePath) || entry.isSymbolicLink()) {
        skipped.push(relativePath);
        continue;
      }
      if (entry.isDirectory()) {
        directories.push(relativePath);
        await visit(relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      } else {
        skipped.push(relativePath);
      }
    }
  };

  await visit("");
  return { directories, files, skipped };
}

async function copyProfilePlan(
  sourceRoot: string,
  destinationRoot: string,
  plan: ProfilePlan,
): Promise<void> {
  await NodeFSP.mkdir(destinationRoot, { recursive: true });
  for (const relativeDirectory of plan.directories) {
    await NodeFSP.mkdir(NodePath.join(destinationRoot, relativeDirectory), { recursive: true });
  }
  for (const relativeFile of plan.files) {
    const source = NodePath.join(sourceRoot, relativeFile);
    const destination = NodePath.join(destinationRoot, relativeFile);
    await NodeFSP.mkdir(NodePath.dirname(destination), { recursive: true });
    await NodeFSP.copyFile(source, destination);
  }
}

async function verifyProfileCopy(
  sourceRoot: string,
  destinationRoot: string,
  plan: ProfilePlan,
): Promise<void> {
  for (const relativeFile of plan.files) {
    const [source, destination] = await Promise.all([
      NodeFSP.stat(NodePath.join(sourceRoot, relativeFile)),
      NodeFSP.stat(NodePath.join(destinationRoot, relativeFile)),
    ]);
    if (source.size !== destination.size) {
      throw new Error(`Profile copy size mismatch for ${relativeFile}`);
    }
  }
}

function readRunningDesktopProcesses(): readonly {
  readonly Name: string;
  readonly ProcessId: number;
}[] {
  const powershell = NodePath.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const script = [
    "$names = @('T3 Code.exe', 'T3 Code (Alpha).exe', 'T3 Code (Nightly).exe', 'T3 Code Hardened.exe')",
    "$items = @(Get-CimInstance Win32_Process | Where-Object { $names -contains $_.Name } | Select-Object Name, ProcessId)",
    "ConvertTo-Json -Compress -InputObject $items",
  ].join("; ");
  const raw = NodeChildProcess.execFileSync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", windowsHide: true },
  );
  return JSON.parse(raw) as readonly { readonly Name: string; readonly ProcessId: number }[];
}

function parseArguments(args: readonly string[]) {
  let apply = false;
  let yes = false;
  let requested: OfficialProfileSource | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--apply") {
      apply = true;
    } else if (argument === "--yes") {
      yes = true;
    } else if (argument === "--source") {
      const value = args[index + 1];
      if (value !== "legacy" && value !== "modern") {
        throw new Error("--source must be followed by legacy or modern");
      }
      requested = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (yes && !apply) throw new Error("--yes is valid only with --apply");
  return { apply, yes, requested };
}

async function run(): Promise<void> {
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone CLI checks its host before any Effect runtime exists.
  if (NodeOS.platform() !== "win32") {
    throw new Error("This migration utility runs only on Windows.");
  }

  const options = parseArguments(process.argv.slice(2));
  const appDataDirectory = process.env.APPDATA?.trim();
  if (!appDataDirectory) throw new Error("Windows APPDATA is not set.");

  const running = readRunningDesktopProcesses();
  if (running.length > 0) {
    throw new Error(
      `Close official T3 and T3 Code Hardened first: ${running
        .map((entry) => `${entry.Name} (PID ${entry.ProcessId})`)
        .join(", ")}`,
    );
  }

  const paths = resolveWindowsDesktopProfilePaths(appDataDirectory);
  const legacyExists = await pathExists(paths.officialLegacy);
  const modernExists = await pathExists(paths.officialModern);
  const selected = selectOfficialProfileSource({
    legacyExists,
    modernExists,
    requested: options.requested,
  });
  if (!selected) {
    throw new Error("The selected official T3 desktop profile does not exist.");
  }

  const source = selected === "legacy" ? paths.officialLegacy : paths.officialModern;
  await assertRealDirectory(source, "Official profile");
  const sourcePlan = await collectProfilePlan(source);
  const targetExists = await pathExists(paths.hardened);
  if (targetExists) await assertRealDirectory(paths.hardened, "Hardened profile");
  const targetPlan = targetExists ? await collectProfilePlan(paths.hardened) : undefined;
  const timestamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
  const backupRoot = NodePath.join(paths.backupParent, timestamp);

  console.log(`Mode: ${options.apply ? "apply" : "dry-run"}`);
  console.log(`Official source: ${source}`);
  console.log(`Hardened destination: ${paths.hardened}`);
  console.log(`Timestamped backup: ${backupRoot}`);
  console.log(`Profile files: ${sourcePlan.files.length}`);
  console.log(`Skipped ephemeral/protected entries: ${sourcePlan.skipped.length}`);

  if (!options.apply) {
    console.log("No files were written. Re-run with --apply after reviewing this plan.");
    return;
  }

  if (!options.yes) {
    const prompt = NodeReadlinePromises.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const confirmation = await prompt.question('Type "MIGRATE" to create the backup and copy: ');
    prompt.close();
    if (confirmation !== "MIGRATE") throw new Error("Confirmation did not match MIGRATE.");
  }

  await copyProfilePlan(source, NodePath.join(backupRoot, "official-source"), sourcePlan);
  await verifyProfileCopy(source, NodePath.join(backupRoot, "official-source"), sourcePlan);
  if (targetPlan) {
    await copyProfilePlan(
      paths.hardened,
      NodePath.join(backupRoot, "hardened-before-migration"),
      targetPlan,
    );
    await verifyProfileCopy(
      paths.hardened,
      NodePath.join(backupRoot, "hardened-before-migration"),
      targetPlan,
    );
  }
  await NodeFSP.writeFile(
    NodePath.join(backupRoot, "migration.json"),
    `${JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        source,
        destination: paths.hardened,
        sourceFileCount: sourcePlan.files.length,
        skipped: sourcePlan.skipped,
      },
      null,
      2,
    )}\n`,
  );

  await copyProfilePlan(source, paths.hardened, sourcePlan);
  await verifyProfileCopy(source, paths.hardened, sourcePlan);
  console.log(`Migrated and verified ${sourcePlan.files.length} files.`);
  console.log(`Backup retained at: ${backupRoot}`);
}

if (import.meta.main) {
  run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
