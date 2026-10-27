# Tracks captures against the Flow View design (U2, round 4)

Pinned capture (Chromium 151.0.7922.34, Linux, bundled fonts) of:
- design: `packages/proof/fixtures/design/tracks-pane-flowview.fdn.html` (chain head recorded in each `design/meta.json`),
- code: honeybeehq/apiary `proto/design-to-code-components` @ 501368d3e8888b11a6745580c3b380d860688b19 (clean),
  Classic TracksPane with the round-4 proposal fixture (Fix findings / Publish preview are normal steps; the proposal adds
  Smoke-test the preview and Write release notes).

Links: Apiary `.foundation/links.json` with `designFile` pointed at the Flow View board and `designHead` / `designHtmlSha256`
removed (the committed link still binds the original design). Command:

```sh
pnpm --filter proof capture --code <apiary@501368d3e> --links <links copy> --design packages/proof/fixtures/design/tracks-pane-flowview.fdn.html --out <out>
```

Each `<state>/1416x720@1/{design,code}` has screenshot.png, dom.json, meta.json and full-extent.png (diagnostic paint with
clipping off). Two independent runs gave byte-identical screenshots.
