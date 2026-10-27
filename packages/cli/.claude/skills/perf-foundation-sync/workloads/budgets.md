# Budget provenance

- Capability command: fresh local process, warmed caches, p95<300ms. Source: orchestrator S6b brief2026-10-24T19:08:16Z; only Tormod or the orchestrator changes it. Source and built are separate series; remote transport, session/edit and installation build are excluded. Shared-host observations are recipe evidence, not a quiet baseline.
- Shared-store sync: p50<=1000ms and p95<=1500ms per direction. Existing S3c ruling2026-10-24T07:58UTC; conditions and retained reference series remain in sync-save-to-session.json. This change does not revise those targets or owners.

H2 `share-held-store`: proposed local maximum1000ms over five warmed saves while
a real Comb append is held. This is an engineering regression gate for the H2
sub-second requirement, not a new operator population ruling. Delivery-before-
release and no-durable-cursor-advance are mandatory correctness invariants.
