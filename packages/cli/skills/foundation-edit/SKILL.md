---
name: foundation-edit
description: Read and atomically edit Foundation documents through CLI, MCP or a live JSON-lines session. Use for Foundation design edits, including bulk style changes.
---

Use the path and node ids in the task packet. Do not search for protocol docs.
`foundation help edit` prints this reference; `foundation skill path` prints its installed path.

Open by path: `foundation session /absolute/design.fdn.html`. By docId: `foundation project path DOC_ID /project` prints the absolute document path from the known manifest; pass that path to `foundation session` or `foundation edit`. MCP `foundation_project({dir:"/project"})` returns the index. This is an index lookup, not a filesystem scan.

Read nodes: MCP `foundation_read({path:"/absolute/design.fdn.html"})` returns canonical HTML with `data-fdn-id` ids. A session's `welcome.doc` contains structured nodes, `welcome.rev` the base revision. CLI `foundation inspect FILE` summarizes; `foundation bake FILE` reads rendered HTML.

Make all changes in ONE operations array. Each node/property uses one operation:
```json
[{"op":"set-style","id":"title","prop":"color","value":"#ff6600"},{"op":"set-style","id":"title","prop":"background-color","value":"#ffffff"},{"op":"set-text","id":"title","text":"Welcome"}]
```
CLI: `foundation edit FILE --ops-file ops.json --label "Recolor" --author agent:NAME`.
Stdin: `cat ops.json | foundation edit FILE --ops-file - --label "Recolor"`.
Inline: `foundation edit FILE --ops '[{"op":"set-text","id":"title","text":"Hello"}]'`.
MCP: `foundation_edit({path:"/absolute/design.fdn.html",ops:[{op:"set-style",id:"title",prop:"color",value:"#ff6600"}],label:"Recolor",author:"agent:NAME",id:"request-1"})`.

Insert: `{"op":"insert-node","parent":null,"index":0,"node":{"id":"new-title","tag":"h1","attrs":{},"style":{},"styleStates":{},"children":[],"text":"Hello"}}`.
Move: `{"op":"move-node","id":"new-title","parent":"frame-id","index":0}`. `parent:null` means document root. Styles use CSS longhand property names; `value:null` removes a property. Token-bound styles require `replaceBinding:true` to replace the binding deliberately.

Session: send `{"t":"hello","protocol":"0.2","client":"agent","author":"agent:NAME"}`, read `welcome`, then send `{"t":"commit","id":"request-1","base":1,"ops":[{"op":"set-style","id":"title","prop":"color","value":"#ff6600"}],"label":"Recolor"}` using the current `rev`. Undo: `{"t":"undo","id":"undo-1"}` in that SAME session; redo: `{"t":"redo","id":"redo-1"}`. A bulk commit is one Undo step. One-shot CLI/MCP Undo history ends when that call closes; use a persistent session when Undo is needed.

Success is a correlated receipt, immediately after the ordered save:
`{"t":"result","id":"request-1","ok":true,"rev":2,"head":{"hash":"...",...},"nodeIds":["title"],"committedAt":"2026-10-24T19:00:00.000Z"}`.
For revision-pinned packets, add CLI `--expected-doc-id UUID --expected-head HASH`, or MCP/session `expectedDocId` and `expectedHead` (null means no chain head). Guards are checked under the same file lock; a mismatch refuses with `conflict` before applying anything.

CLI/MCP also include `path`; `--id`/`id` supplies the correlation id, otherwise one is generated. `rev` is session-local; `head.hash` identifies the saved change across writers. A no-op returns the existing head and empty nodeIds. Failure: `ok:false`, `code`, `message`, current `rev`/`head`, and empty `nodeIds`; the batch is refused atomically. CLI exits 1; MCP sets `isError`. Never wait for another confirmation after success. Session `doc` and subscribed bakes follow independently. A busy document can refuse with a reason; retry the batch only after inspecting that reason.

`id` correlates a request; it is not a deduplication key. After `write-failed`, read the current head before retrying and use `expectedHead` to guard the retry. A storage failure can leave recovery work pending.

Normal writes keep Foundation's existing atomic save behavior. Opt into filesystem flush before the receipt with CLI `--durable`, or MCP/session `durable:true`. Use that option only when the task needs stronger disk durability; it adds flush latency.

Images: use `import-image` by default when adding an image through Foundation tools. In the same commit, insert an img node then `{ "op":"import-image", "id":"new-image", "source":"https://example.com/photo.jpg" }`. Source accepts URL, local file path (relative to the document), or data URI. For a fill add `"property":"background-image"`. Bytes are sniffed, limited to 20 MiB and stored beside the design at `.foundation/assets/<sha256>.<ext>`. Never construct absolute stored references. Generic edits preserve remote images until requested.

Store existing remote images explicitly with `{ "op":"localize-images", "nodeIds":["frame-id"] }` (omit nodeIds for the whole document). One commit is one undo. Per-image `images` results say `stored` or `failed` with a reason; failed images retain their source. An all-failed/no-change batch has empty nodeIds, unchanged head and no undo step. Existing relative paths and data URIs are untouched by localization. CLI: `foundation images FILE`, `foundation import-image FILE SOURCE --node ID`, `foundation localize-images FILE [--node ID]`. MCP: `foundation_images`, `foundation_import_image({path,nodeId,source,property?})`, `foundation_localize_images({path,nodeIds?})`; guards and author fields work as for foundation_edit. Session read `{ "t":"images", "id":"images-1" }` returns nodeId, property, src, sourceUrl, stored, mime, bytes and hash per image. Keep `.foundation/assets/` with the document when moving or syncing it; retain blobs for undo. Session bakes keep relative references, while CLI bake and PNG export resolve local bytes.

For image operations, always check `images[].status` even when the commit receipt is ok: the document batch can commit while a download fails. CLI edit/image commands exit 1 and MCP edit/image tools set isError when any image fails; successful images and unrelated changes remain saved. `data-fdn-source-url` records only http(s) provenance, never local paths or data URI bytes. Mutations from the same session queue behind an in-flight image import; another writer can still cause a conflict.
