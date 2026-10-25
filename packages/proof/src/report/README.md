# Proof artifacts

Run `pnpm exec tsx packages/proof/src/report/cli.ts seal OUT/proof-manifest.json OUT/default/drift-report.json ...`, then `pnpm exec tsx packages/proof/src/report/cli.ts verify OUT/proof-manifest.json CODE_REPO DESIGN_REPO POLICY_JSON`.

Canonical encoding sorts object keys recursively, preserves array order and uses JSON scalar encoding. `reportHash` is SHA256 over the canonical report without `reportHash`. The manifest binds paths, report hashes and artboard/state/viewport identities and has its own `manifestHash`. Changing object key order does not change a hash; changing content does.

Verification requires a separately trusted policy fixing the five maximum tolerances, the required artboard/state/viewport matrix, and design binding mode. HTML SHA256 is mandatory. The CI example loads policy from the base revision; generating the required matrix from the same reviewed links configuration avoids maintaining a second list.

Verification recomputes both hashes, rejects a dirty code checkout, replays comparison from bundled hashed capture inputs, compares measured drift/pixels/verdict and capture bindings, compares the report's code commit to the supplied code checkout HEAD, compares its design binding to the actual `.chain`, checks HTML SHA256, and fails for any drift, malformed report, missing source, stale binding or not-provable state. `chain-head` uses the engine's chain head; `chain-sha256` uses SHA256 of sidecar bytes. A missing external binary chain cannot be checked using a digest copied from the report itself.

Hashes provide integrity and bindings, not author identity or trusted measurements. This prototype does not sign: CI would otherwise need a signing key before there is an agreed trust model. A later deployment can sign the canonical manifest using `ssh-keygen -Y sign` with a pinned CI public key and namespace; signature checks must be additional to source binding and drift checks. Keep captures and the diff as review evidence. Re-hashing an edited report is not independent proof that its measurements are true.

`verify-example.ts` runs actual CLI processes against a temporary git repository and a real Foundation chain, records passing chain-head and chain-sha256 controls plus failing drift, tamper, stale-binding, coverage, policy and dirty-source checks in `evidence/verify-runs.json`. It is a verification mechanics demonstration, not evidence the app matches its design. The example workflow is inactive and requires a capture-generation step and correctly configured repository/ref before use.

The trusted runner must generate captures from the declared sources. Replay verifies captured measurements; it cannot attest that captured bytes were produced by a particular build. No signature or trusted build attestation is claimed.

`policy.example.json` is illustrative. Replace its matrix with the complete reviewed links matrix. Real enforcement also requires a protected required CI check (or repository review rules covering workflows and policy); a pull-request-controlled workflow can otherwise remove the verification step itself. The inactive example does not configure repository protection.

Generate the matrix directly from reviewed/base-revision links: `pnpm exec tsx packages/proof/src/report/cli.ts policy TRUSTED_LINKS.json proof-policy.json`. `policyFromLinks` uses every linked artboard/state/viewport and the common default tolerances. Review and protect the generated policy and source links; never derive required coverage from the candidate manifest.
