# Comments on a design

Leave feedback on a selected layer, resolve it, and return to that layer later.

## Sub-features

- `comments.open`: every comments entry opens the same pane.
- `comments.post`: saved comment has its text, unique ID, open status, and selected node anchor.
- `comments.resolve`: resolve and reopen persist.
- `comments.jump`: Show layer selects the comment's anchor and returns to Design.

## How to get to it (user POV)

Use the Comments dock button, Activity in the inspector, the save-status footer (also Enter/Space), or C while focus is outside a text field. Post in Comments & sync, then use Resolve/Reopen or Show layer on a comment card.

## Driving it with control-foundation

Preconditions: fresh baseline; select `heading` through the Layers tree first.

- Open: `C click '[data-future="comments"]' --label comments-dock`; `C wait '#collaboration-pane' 'Comments & sync'`. Other entries are `C click '[data-future="activity"]' --label comments-activity`, `C click '#save-status' --label comments-footer`, and `C press c --label comments-shortcut`. These toggle: close the pane with `C click '#design-mode'` between entry-point checks.
- Post: `C fill '#comment-text' 'VERIFY comment A' --label comments-compose`; `C snapshot` must show enabled Post comment. `C click '#post-comment' --label comments-post`; `C wait-state document.annotations.0.text '"VERIFY comment A"'`; `C wait-state document.annotations.0.nodeId '"heading"'`; `C wait '#comment-list' 'VERIFY comment A'`. The textarea must clear only after the saved receipt.
- Resolve: `C click '#comment-list button:text-is("Resolve")' --label comments-resolve`; `C wait-state document.annotations.0.status '"resolved"'`. Reopen via `C click '#comment-list button:text-is("Reopen")' --label comments-reopen`; assert `"open"`.
- Jump: `C click '#comment-list button:text-is("Show layer")' --label comments-jump`; `C snapshot` must show heading selected and Design visible.
- Persistence: `C restart --label comments-reopen-app`, open Comments, and check the same comment text/ID/status in `state` and in the pane.

## Gotchas

Resolve/Reopen/Show layer selectors above assume exactly one comment. For several, scope to `.comment-card:has-text("VERIFY comment A")`. Post is disabled for blank text or while a write is pending. A successful fill is not proof of submission. Same author in two clients must still yield distinct comment IDs; use the sync recipe. Keep comment text unique to the run.
