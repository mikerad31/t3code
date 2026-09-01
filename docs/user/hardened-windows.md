# T3 Code Hardened on Windows

T3 Code Hardened is a separately installable downstream desktop application. It keeps the normal
T3 Code experience while using a distinct Windows application identity and Electron profile.

| Property               | Hardened value                  |
| ---------------------- | ------------------------------- |
| Product name           | `T3 Code Hardened`              |
| Windows application ID | `com.mikerad31.t3code.hardened` |
| Electron profile       | `%APPDATA%\t3code-hardened`     |

The official T3 Code installation and its Electron profile remain in place. Installing or removing
one application does not replace the other. A fresh Hardened installation starts with a fresh
Electron profile; profile migration is optional.

The migration utility copies eligible Electron application/profile data only. It does not migrate
the T3 server home and never traverses or copies `.codex`, `.codex-a2`, `.codex-a3`, or similarly
named Codex state. Caches, crash data, logs, transient journals, locks, sockets, symlinks, and
junctions are skipped. Both desktop applications must be closed before a migration dry run or
apply operation.

Hardened desktop updates are restricted to releases from `mikerad31/t3code`. An official
`pingdotgg/t3code` updater configuration is ignored by Hardened at runtime.
