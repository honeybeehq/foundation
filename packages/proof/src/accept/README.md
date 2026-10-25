# Reviewed differences (`fdn-accepted/0`)

The code repository owns `.foundation/accepted.json`. Its root is
`{"schema":"fdn-accepted/0","entries":[]}`. Each entry has:

- `id`: stable unique-defect id, never a raw `dN` sequence number.
- `scope`: exact `artboard`, `state`, and `viewport: {width,height,dpr}`.
- `layer`: design id and code `data-fdn-id` or captured DOM path.
- `code.component`: the linked code export path; changing it requires review.
- `code.pixelsSha256`: the captured code pixels inside every excluded rectangle; image/canvas/SVG edits inside accepted bounds also go stale. The summary displays the excluded image area.
- `kind` and `values`: the kind plus all constituent findings' layer, property,
  design/code values (and missing/extra boxes), sorted independently of raw ids.
- `reason`, `reviewer`, and ISO `date`.
- `design: {htmlSha256,head}`: exact design HTML digest and chain head.

From a sealed report:

```sh
pnpm exec tsx packages/proof/src/accept/cli.ts accept DEFECT_ID \
  --report proof/empty/drift-report.json \
  --file /code/repo/.foundation/accepted.json \
  --reason 'Keep the shorter Classic explanation' --reviewer 'Reviewer name'
```

The installed CLI has the same `foundation-proof accept ...` command. Commit
this list through normal code review. A reviewer name is an audit field, not an
authentication mechanism or approval signature. The demo entry is explicitly
agent-reviewed prototype policy, not Tormod's product approval.

Recapture, compare, bind with `bindAccepted`, and seal the manifest after editing
the list. Reports embed the entire list and its canonical SHA256, so changing it
without regenerating the proof fails. Raw measurements remain unchanged;
`defects[].accepted` and `summary.accepted` record the reviewed differences.
Verification recomputes both measurements and acceptance. It returns accepted ids
and reasons separately from errors.

A changed design HTML digest or chain head fails with:
“design changed since this difference was accepted; re-review or update the design”.
Changed code/property values, changed group membership, unknown ids/scopes,
duplicate entries and malformed lists also fail. Removed differences require
removing the old entry rather than leaving a silent exemption. Uncertain and
environment findings cannot be accepted. The list cannot cover an unmeasured
state or unexplained pixel-only drift. Pixel results are retained: no masking or
screenshot repainting occurs. Verification counts residual pixel changes outside the union of accepted findings’ design/code boxes and still applies the pixel tolerance there. A text acceptance cannot waive unrelated image/canvas drift. Missing/extra acceptances also hash the entire present-side subtree (descendant tags, text, boxes and painted styles); same-box content edits go stale. Missing snapshots refuse acceptance. Environment findings require an explicit trusted cause allowlist; uncertain or ungrouped findings still block verification.

Old reports without `defects[]` have a deterministic per-layer/property fallback
prefixed `legacy-`; regenerate reports with the current comparison tool before
adopting a reviewed list.
