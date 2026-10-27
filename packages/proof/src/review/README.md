# Review the advisory pilot

Download an Actions artifact and keep its `review-index.json` beside the component/state report directories. Install the exact engine-free CLI used by that run. From the code repository, start a measured session **after** download/setup, inspect each candidate and its images, and record your decision:

```sh
foundation-proof review-start /path/to/proof/review-index.json --reviewer 'Your name'
foundation-proof review /path/to/proof/review-index.json 'keycap/default/160x60@1::def-...' real --note 'The text is visibly too light'
foundation-proof review /path/to/proof/review-index.json 'inbox-row/selected/340x100@1::def-...' accept --note 'Keep the current compact spacing'
foundation-proof review /path/to/proof/review-index.json 'keycap/default/160x60@1::def-...' false --note 'Equivalent box-model implementation, no visual defect'
foundation-proof review-end /path/to/proof/review-index.json
```

`review RUN DEFECT_ID real|accept|false --note ...` also accepts an unqualified defect id when it occurs only once in that run. To use the numeric run id, copy the artifact's proof contents into `.foundation/review-runs/RUN/`; otherwise pass the downloaded index path as above. `--code REPO` selects the code checkout. Commit `.foundation/review-log.json` after the session. The `accept` decision additionally writes a normal `fdn-accepted/0` entry in `.foundation/accepted.json`; it must be a provable product candidate and inherits the existing strict component/design/value/subtree/pixel bindings.

Only product groups enter review decisions and verdict-frequency statistics. Uncertain and environment groups remain visible separately. A pre-existing valid accepted-list entry is already intended, without asking twice. The run key includes the GitHub run attempt, for example `123456.1`.

Review log schema is `fdn-review-log/0`: history-preserving `entries[]` record scoped key, original defect id, measured-claim fingerprint, decision, note, reviewer, source run, timestamp, session id and milliseconds since the prior review action. `sessions[]` record start/end and total wall time. Ended-session duration, including image reading and command entry, is the review-time measure; it is not summed CLI process time or a human-speed benchmark. Do not include installation, artifact download, unrelated work or idle breaks in a timed session. End a session before a break and start another afterwards.

The next CI run shows unchanged reviewed items with their decision, note and original run. It asks again if the design revision, scope, component, constituent measured properties or missing/extra subtree contents change. `real` and `false` reviews are tied to the measured claim, not the whole code commit or unrelated pixels, so adding a different property does not reopen every existing item. `accept` also reopens if its strict acceptance becomes stale. Stable scoped ids include component, state and viewport because an underlying defect id can occur in several states.

A false-alarm decision does not delete raw evidence, tune the frozen matcher, raise an accuracy score or make verification pass. All modes in the pilot workflow are advisory and no release is automatically blocked. Reviewer identities and timings are repository audit fields, not authenticated signatures. Production adoption needs normal human review, ownership rules and a way to validate identities and sessions.

Only one timed session may be active across all runs. Use `review-abort RUN --note REASON` to close an orphaned/idle session; aborted sessions and their durations are excluded from timing totals, while already-recorded decisions remain audit history. The log is rewritten atomically, not cryptographically append-only. A failed log write rolls back the acceptance file. Switching an existing intended decision to real/false removes its prior accepted-list exemption.
