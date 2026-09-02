# Hardened Windows build and profile migration

## Distribution identity

The downstream identity is defined once in
`packages/shared/src/desktopDistribution.ts` and consumed by the Electron runtime, artifact
builder, updater validation, and migration utility.

| Property                 | Value                                    |
| ------------------------ | ---------------------------------------- |
| Version                  | `0.0.37-hardened.2`                      |
| Product name             | `T3 Code Hardened`                       |
| electron-builder `appId` | `com.mikerad31.t3code.hardened`          |
| Windows user data        | `%APPDATA%\t3code-hardened`              |
| Updater cache            | `%LOCALAPPDATA%\t3code-hardened-updater` |
| Update repository        | `mikerad31/t3code`                       |

The packaged runtime does not fall back to either official profile path. Development runs retain
their existing `T3 Code (Dev)` / `t3code-dev` behavior.

## Optional official-profile migration

Close official T3 Code and T3 Code Hardened first. The utility checks exact installed executable
names and exits before reading or writing when either application is still running.

From the repository root, inspect the default dry run:

```powershell
node .\scripts\migrate-windows-desktop-profile.ts
```

The source is derived from the current Electron configuration. The official runtime prefers the
legacy `%APPDATA%\T3 Code (Alpha)` profile when it exists, otherwise it uses
`%APPDATA%\t3code`. Override that derived choice when both exist:

```powershell
node .\scripts\migrate-windows-desktop-profile.ts --source modern
node .\scripts\migrate-windows-desktop-profile.ts --source legacy
```

After reviewing the source, destination, backup path, and counts, apply interactively:

```powershell
node .\scripts\migrate-windows-desktop-profile.ts --apply
```

Type `MIGRATE` at the prompt. For a pre-confirmed unattended invocation, use `--apply --yes`.

Before the Hardened destination is changed, the utility creates and verifies a filtered source
backup. If the Hardened profile already exists, it also creates and verifies a filtered snapshot
of that profile. Backups are written below:

```text
%APPDATA%\T3 Code Hardened Migration Backups\<UTC timestamp>\
```

The copy excludes all `.codex*` trees, symlinks/junctions, caches, crash data, logs, temporary
directories, singleton/process files, locks, temporary files, journals, SHM files, and WAL files.
It verifies every copied file by size. The utility never reads from or writes to `%USERPROFILE%\.codex*`
or the T3 server home.

## Build

Use the repository's existing Windows x64 artifact path:

```powershell
vp run dist:desktop:win:x64
```

The builder emits an NSIS installer named from
`T3-Code-Hardened-${version}-${arch}.${ext}` and embeds the distinct product name and app ID.
Local builds are unsigned unless the existing Azure Trusted Signing environment is configured.
An unsigned installer is suitable for controlled installation but may trigger Windows SmartScreen;
sign public installers with the existing release signing path.

## Update publication contract

Hardened builds always generate GitHub provider metadata for `mikerad31/t3code`. Environment
variables such as `GITHUB_REPOSITORY` or `T3CODE_DESKTOP_UPDATE_REPOSITORY` cannot redirect a
Hardened build to the official repository. The runtime independently accepts only a GitHub feed
whose owner and repository match the downstream identity.

No GitHub release is created by the local build. To activate automatic updates later:

1. Sign the Windows installer for public distribution, or explicitly accept unsigned-install risk
   for controlled machines.
2. Publish a normal GitHub release in `mikerad31/t3code` for the Hardened version. Although the
   semantic version has a `hardened` prerelease suffix, the release must be visible to GitHub's
   latest-release endpoint.
3. Upload the NSIS `.exe`, its `.blockmap`, and the generated `latest.yml` together. Do not edit
   the generated hashes or URLs.
4. Publish the exact matching `t3@0.0.37-hardened.2` server package before exposing the release if
   remote **Update server** functionality is required. Local desktop startup uses the bundled
   server and does not depend on npm publication.
5. Run `vp run release:smoke` against the assembled release assets before publishing it to users.

Publishing credentials, signing identities, and tokens belong only in the release environment;
they are never embedded in the application or committed to the repository.
