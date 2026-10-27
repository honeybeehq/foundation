# Round-5 big-panel ground truth (P3 part 2)

Blind hand labels for the matched-data captures in `../round5-big-panels/captures/` (Foundation 2d14c0c):
`help-center/agent-run`, `help-search-split/split`, `tracks/{track-selected,proposal-pending,empty}`.
Same columns as `../ground-truth/README.md`. Extra per state: `<state>.layout-scope.csv` (`id,in_layout_check,why`)
marks the defects a layout-only check should find: presence (missing/extra), order, or element geometry.
Colour, type, shadow, text-only and environment rows are `no`.

- HelpCenter correspondence: `../ground-truth/tools/r5_big_correspondence.py <capture> <out.csv> <state>.overrides.json`
  (same data-fdn-id first, then unique text, then paint; the overrides file holds the hand rules).
- Tracks correspondence: the round-4 rule script `tools/tracks_flowview.py` (on proto/dtc-r4-labels), re-run on
  THESE captures. Checked directly against round 4 (`sample-captures/tracks-pane-flowview`):
  - code screenshots for track-selected and proposal-pending are byte-identical; their code DOM differs only in
    the collector's text joining (`2 changes` instead of `2 change s`), which renders the same;
  - the empty state is a new native-context capture, 1114×468 instead of 724×468 (canvas 846px wide, content
    re-centred); its design/code pair still has no product difference;
  - the design captures have a `display:contents` root (`0`) instead of a block root, and sub-pixel box changes;
    their screenshots differ only in anti-aliasing (no element moved, no style changed).
  So every round-4 cause still holds on these images and DOM, and the rows carry over. Environment rows point at
  design `0/0` because the design root `0` is now `display:contents` and paints nothing.
- Fixed HelpCenter chrome copy (footer hints, count wording) is labelled as a real difference with
  likely_intentional `unsure` or `yes`.
