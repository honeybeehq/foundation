# Git integration

Run `foundation git setup` in your repository, then commit `.gitattributes`.
Repeat setup in each clone. It preserves existing attributes and adds these
rules once:

```gitattributes
*.fdn.html.chain merge=foundation
*.fdn.html merge=foundation
```

It sets repository-local configuration:

```sh
git config merge.foundation.name 'Foundation chain-aware merge'
git config merge.foundation.driver 'foundation git-merge-driver %O %A %B %P'
```

`foundation` must be on PATH for Git processes. `%O`, `%A`, `%B` are temporary
ancestor, ours and theirs paths; `%P` is the real repository path. Setup also
excludes local receipts, pending saves and locks in `.git/info/exclude`.
Repeated setup leaves attributes and excludes unchanged, and updates this
named driver to the current command.

## Merge behavior

The binary driver merges both complete chains with Loro. Concurrent property
writes follow Loro's deterministic conflict resolution; overlap warnings are
review signals. Invalid chains and mismatched document identities fail.
The common ancestor argument is not needed because chains retain history.

The HTML driver reads sibling `<P>.chain` objects from Git, never from a
possibly stale working-tree sibling. It considers index stages 2/3, HEAD,
MERGE_HEAD, REBASE_HEAD, CHERRY_PICK_HEAD, FETCH_HEAD and incoming commit IDs
Git exposes through GITHEAD_<sha> environment keys. MERGE_HEAD is often not
yet written while Git invokes drivers, so the incoming commit IDs matter.
Local reference tips are also candidates, covering a single cherry-pick before
CHERRY_PICK_HEAD exists. Each candidate must match the temporary HTML side's document identity,
frontier and complete projected text exactly. It then merges those two
chains and regenerates the HTML including identity and version markers.

This keeps HTML unchanged in format and makes the drivers independent of
invocation order. No hook or post-merge save is required. Keep both HTML and
its sibling chain tracked and committed together. External text edits must
be ingested before merging.

If either side cannot be identified, a snapshot is invalid, or text differs
from its chain, the driver returns nonzero and Git reports a conflict. It
never keeps ours and claims success. Renames where Git cannot find matching
sibling objects, older projections without frontier markers, and unusual
Git invocations without accessible side references may require manual
resolution. In particular, stash apply/pop, apply-backend rebases, git am -3,
and cherry-picks of non-tip commits may fail visibly. Criss-cross merges
with virtual ancestors are not verified. Merge binary chains with `foundation chain merge <file>
<theirs.chain>`, inspect the regenerated projection, then stage both files.

Do not use `git revert` to undo design edits: the binary driver unions history
and does not create inverse changes. A revert may either restore an earlier
file trivially or retain later history when the merge driver runs. Use
Foundation session undo or explicit semantic edits instead.

## Stable saves

Simple Loro snapshot measurements were byte-identical, but broader tests found
encoding changes after loading or materializing complex documents. Saves now
rebuild a fresh Loro document by importing full-history changes in deterministic
order, then export a standard snapshot with sorted anchor metadata. A version-vector check rejects an incomplete rebuild before any files are
written. No history is removed, and existing `LoroDoc.fromSnapshot` readers remain compatible.

Use the lockfile-pinned Loro release across writers; an encoder upgrade may
change canonical bytes and should be verified before rollout.

Canonicalization can produce a one-time byte diff when an old chain is first
saved. Subsequent saves agree across opposite import orders, blob exchange and
both merge directions. Projection output is deterministic too. Unchanged saves
compare bytes before writing, preserving chain, HTML and receipt mtimes.
Rebuilding adds save work proportional to retained history: the tracks-pane
fixture with 1,000 additional edits took roughly 48–72 ms per save on metal-1.

Real CLI integration tests exercise merge, rebase and cherry-pick in scratch
repositories using local branches with FETCH_HEAD removed, verify both edits
and exact projection bytes, then sync twice and check clean Git status and
unchanged file mtimes.
