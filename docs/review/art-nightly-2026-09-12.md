# Foundation review — 2026-09-12

Custom-target deployment used an unanchored regular expression to find the app, then requested Quit by the shared name `Foundation`. A target path could therefore match another command or another app path, and the Quit request did not identify the selected bundle.

The repair escapes and anchors the executable path and passes the target bundle as a separate AppleScript argument. Default paths, the bounded post-Quit check, packaging and bundle swap remain unchanged. No PID kill was added.

The actual deploy module body was executed with virtual filesystem/process boundaries: all three focused cases failed on main `98f0befb6b6cf1a65bcd048bbea00ab3b5c009b9`; after repair, all 15 Node tests passed. The cases cover a second installed copy, a regex-dot false match, and the executable appearing only in another command's arguments. The first fixture attempt failed because its VM lacked `URL`; that harness failure is retained separately and is not source evidence.

This proves command selection, not macOS application resolution. Publication of the Quit change requires two owned same-bundle-ID app copies: only the selected target must exit. No installation, deployment or actual app shutdown occurred during the source test. Process matching still relies on an absolute executable in argv; it is not a defense against deliberately spoofed argv.

The frozen review scope is 54 commits: the prior 49 exact raw diffs plus published commits `a81ce0e`, `d9817e9`, `e4751b1`, `739d89e`, and `e3d9823`. All 45 prior inspected module blobs match published main. The added five full diffs were inspected against callers and tests. The mandatory simplification pass preserves the existing help simplification, parser guards, distinct test runners and lifecycle boundaries; no additional behavior-preserving simplification was established.

Prior packaged data checks, same-machine recovery/lease handoff, and all 17 two-machine HOST/API outage checks remain passed. Native export dialogs, deliberate occlusion/titlebar, the bundled two-client launcher, actual custom-target Quit resolution, and second-machine renderer GUI proof are separate remaining checks. Previous serial Vitest evidence was 69 suites/720 tests passed; the original runner mismatch and accidental parallel timeout remain failures in the retained records, not green full-run claims.
