# Origin labels in durable history

Based on rollout/fdnx-on-main-2 at69e1487. Existing envelope originNode and
identity/storage bytes are unchanged. Engine log/activity DTOs have null
assurance by default. A small ephemeral observer drains only commits actually
made by that engine instance; load/import/merge never populate it. After a
successful CLI save, their hashes receive local observer receipts. This also
covers session writers, raw-file ingest, initialization, anchors and copy.

Local history/session log/incremental activity reads add
`originNode: string | null` and `originAssurance: 'writer-stated' | 'local' | null`.
Raw origin is a display claim, never authorization. Local receipts take
precedence; matching author/node labels cannot create one. Signed receipts are
written in the queued activity flush or after validated encrypted materialize,
using the transport's verified member-device result. They are private,
append-only, hash-scoped observer state outside chain files and git. Retained
verified journal records backfill on daemon startup. Unknown metadata is null;
old local-looking strings are not upgraded by guesswork. Later member removal
does not erase historical display assurance.

Actual real-run command:
`pnpm exec tsx packages/cli/scripts/share-proof.ts /absolute/comb-bridge --local-model`

This uses actual CLI/daemon/SSH signing/libsodium/Comb b73e9bb with two isolated
HOMEs and a clearly labelled loopback GitHub identity/permission/descriptor stub.
The child writers claim distinct configured node labels alice/bob; it is one
machine, not a real two-host or GitHub App acceptance claim. A local edit saved
during the outage later appears exactly once as baseline imported activity. A
fresh receiver CLI log read shows originNode alice and assurance writer-stated;
the writer's fresh CLI log read shows local. The delayed fact never becomes a
live lease. All prior encrypted sharing/materialize/refusal/rotation/outage/
raw-store grep/backup checks pass. Daemon chatter is filtered in real-run.log.

Tests cover unchanged chain bytes and verification, no local assurance for
imported matching-origin history, local precedence, fresh CLI log and incremental
session reads, and retained verified-journal backfill without inferring authorship
from source local. The journal notice recipe uses 10k synthetic cached bodies
and real engine changes: max0.36ms notice callback; flush separately2.4–3.3ms.
This is a local recipe, not a latency SLO; its commit field names the dirty base.

One unscoped test attempt discovered the fetched Comb source's node:test file;
it was stopped and replaced with an explicit packages-only suite. Early new-test
failures were observer setup errors (CLI file/log order, missing required hello
author and treating an activity baseline as a delta); those were corrected.

Final frozen package suite:934 tests across111 files, --maxWorkers=1; typecheck
passes. Focused history/session/journal/envelope subset:37 tests in4 files.
