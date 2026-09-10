# Document CLI and export

Create a Foundation document, validate it, bake/render it, inspect its change history, or export the desktop design.

## Sub-features

- `documents.new`: a canonical HTML document and chain are created.
- `documents.validate`: valid and invalid documents produce honest diagnostics/exit codes.
- `documents.bake-render`: HTML and rendered artifacts reflect the document.
- `documents.chain`: chain verification, history, anchors and filesystem exchange.
- `documents.export`: desktop export creates a new directory with HTML and chain, and cancel leaves no export.

## How to get to it (user POV)

Use `foundation` from a terminal. Desktop Export opens a native save dialog. Apiary's design-board pane is another integration entry point; inspect its live commands/surfaces with Apiary tools before driving it.

## Driving it with control-foundation

Preconditions: dependencies installed; the document CLI can run without any desktop/host. Use a separate fresh directory for CLI artifacts. The control CLI drives desktop UI only; capture document CLI invocations with a harness-native subprocess, recording argv, cwd, stdout, stderr, and exit code for each command.

- Create: in an empty verification working directory, invoke `"$REPO/node_modules/.bin/tsx" "$REPO/packages/cli/src/main.ts" new verify-document` with cwd explicitly set to scratch. Expect `verify-document.fdn.html` and `verify-document.fdn.html.chain`. Set `REPO` to this checkout's absolute root.
- Validate/inspect: from the same cwd, invoke that CLI with `validate verify-document.fdn.html` and `inspect verify-document.fdn.html`; require exit zero, no validation errors, and the expected document summary.
- Bake: invoke `bake verify-document.fdn.html -o baked.html`; inspect the emitted file and rendered visible content. Render uses `render verify-document.fdn.html -o render`; capture the resulting PNG, layout and render manifest. Run `--help` for command-specific flags before extending to states/viewports.
- Chain: invoke `chain verify-document.fdn.html verify` and `chain verify-document.fdn.html log`; expect verified history containing document creation. Filesystem push/pull, anchors/diff, freeze, import and gateway/MCP have separate command/test contracts in `packages/cli`; do not count them as covered by new/validate.
- Desktop export: `C click '#export' --label documents-export` opens the actual native dialog. Use OS UI driving to choose a new directory under the run, then inspect both exported files with the document CLI. Cancel must leave no export; choosing an existing directory must be refused. The control CLI cannot automate the native save panel. Do not replace it with a direct host export call and claim UI coverage.

## Gotchas

The README's Pre-L1 status is historical; current capabilities are grounded in CLI help and the desktop source. `new` chooses paths relative to the subprocess cwd; never let it write into the repository root accidentally. Some CLI commands can invoke network/browser work or write files; a name such as dry-run is not proof of no side effects. Read the specific implementation/help and observe outputs. A desktop pass does not prove Apiary integration or the CLI. Keep exports and generated documents uncommitted.
