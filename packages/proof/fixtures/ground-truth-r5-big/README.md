# Round-5 big-panel ground truth (P3 part 2)

Blind hand labels for the matched-data captures in `../round5-big-panels/captures/` (Foundation 2d14c0c):
`help-center/agent-run`, `help-search-split/split`, `tracks/{track-selected,proposal-pending,empty}`.
Same columns as `../ground-truth/README.md`. Extra per state: `<state>.layout-scope.csv` (`id,in_layout_check,why`)
marks the defects a layout-only check should find: presence (missing/extra), order, or element geometry.
Colour, type, shadow, text-only and environment rows are `no`.

- HelpCenter correspondence: `../ground-truth/tools/r5_big_correspondence.py <capture> <out.csv> <state>.overrides.json`
  (same data-fdn-id first, then unique text, then paint; the overrides file holds the hand rules).
- Tracks correspondence: the round-4 rule script `tools/tracks_flowview.py` (on proto/dtc-r4-labels) run on the new
  captures. Tracks code captures are byte-identical to round 4 and the design DOM is unchanged, so the round-4
  defect rows carry over (environment rows now point at design `0/0`, as the design capture has no root wrapper).
- Fixed HelpCenter chrome copy (footer hints, count wording) is labelled as a real difference with
  likely_intentional `unsure` or `yes`.
