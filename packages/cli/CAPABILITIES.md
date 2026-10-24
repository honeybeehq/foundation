# Read-only node capabilities

Run this before choosing a local Foundation runtime for a design:

```sh
foundation doctor --capabilities --json \
  --product-root /absolute/product/directory \
  --design-path /absolute/product/directory/design.fdn.html
```

The command emits one compact JSON line, exits, and does not open a session, execute discovered Foundation binaries, read design contents, fetch Git, or change the checkout or installation. Invalid flags or relative paths return exit2 with stderr and no partial JSON. Both path arguments are optional; `--design-path` requires `--product-root`.

```json
{"capabilitiesVersion":1,"node":"metal-3","foundation":{"installed":false,"path":null,"sourceSha":null,"sessionProtocols":null,"documentFormats":null,"artboardWriteSafe":null,"quickrefPath":null},"checkout":{"present":true,"repoRoot":"/home/trmd/owned-product","head":null,"designPath":"/home/trmd/owned-product/design.fdn.html","designPresent":false}}
```

`node` is `FOUNDATION_NODE_ID` when supplied, otherwise the hostname. It is diagnostic; the calling service owns the authenticated machine identity.

`foundation` describes the first executable found through PATH, then the known `HOME/.local/bin/foundation` fallback. `path` is its realpath. Version, protocols, formats and write safety come only from its explicit `foundation-install.json` stamp. An old unstamped shim can have `installed:true` and a path while all metadata remains null. The probe's own source checkout does not prove the discovered installation's capabilities. `quickrefPath` is the readable absolute installed `packages/cli/skills/foundation-edit/SKILL.md`, or null.

If the service deliberately selects an absolute runtime or a temporary artifact, pass `--foundation-path /absolute/artifact/foundation`. The probe inspects exactly that executable and its stamp, with no fallback to an older PATH runtime when it is missing. This does not install or execute the artifact. A temporary-HOME install from an exact committed SHA supplies the same honest stamp as a node installation without changing the global runtime.

`checkout.present` means the explicitly named directory is readable. It can be a nested directory or a non-Git folder. `repoRoot` is the containing Git root when found, otherwise the canonical provided directory. `head` is null for a missing/unborn/non-Git checkout or a failed100ms Git query. Inherited `GIT_*` context is removed. No other checkout is searched.

When requested, `designPath` preserves the exact absolute argument, including `/tmp` aliases. `designPresent` means a readable regular file exists inside the canonical provided directory. A symlink escaping that directory returns false. A file existing only in the working tree can be present even though Git does not track it; HEAD is not a file-existence receipt. Without `--design-path`, both design fields are omitted.

An Apiary service can invoke the command locally before session hello, parse the single JSON line, and then open the selected runtime. A node helper can invoke the same command and return its output. The caller chooses transport and refresh policy; Foundation stores no capability cache. Keep remote routing disabled until that destination has a receipt. `installed`, `path` and `designPresent` are necessary facts; unknown metadata is not proof that a runtime supports the current fast-edit request or receipt format. Opening the actual session remains the operational check.

The S6 inventory found no node-level Foundation on metal-3. A design existing only in Studio's working tree will remain absent there until explicitly copied or live sharing is deployed. Neither a Product registration nor a matching HEAD changes that fact.

New installed launchers dispatch this probe to a small bundle built during installation. Source CLI dispatch loads command modules lazily. The isolated recipe is `node packages/cli/scripts/capabilities-proof.mjs --out .audit/capabilities.json`; add `--source` for the source CLI population. Each recipe checks negative cases, single-line JSON, file hashes and20fresh processes. The performance map records the local warm-cache p95<300ms requirement. Shared-host timing receipts are observations, not a fleet-wide or network-filesystem latency guarantee.
