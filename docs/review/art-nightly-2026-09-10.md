# Foundation review — 2026-09-10

This publication removes the unused internal exported `CommitBody` type and its sole type-only `ChangeMeta` import from `packages/desktop/src/contract.ts`. The desktop package is a private application with no package/type exports; all local contract consumers and the Apiary integration were searched. Its JavaScript entry is `dist/main.cjs`. The exact frozen and simplified source produce byte-identical JavaScript through the installed esbuild transformer.

Main simplification: `af20a49366c554838287fe15b116a962beae04f7`, based on `0b80e87b9e4f7dc32d151d7a689e936e20a45518`. No runtime behavior, validation, permissions, persisted data, or supported feature changes. Prototype and desktop baseline tests passed; the same 11 desktop tests and project typecheck passed after the change.

## Review and simplification scope

All 40 source candidates were reviewed with callers, tests and later supersession. None is a merge commit. Eighteen branch/main pairs have byte-identical full binary parent-to-commit diffs. This is 40 SHA outcomes, not 40 distinct patches.

The required `radically-simplify` pass used skill SHA-256 `67e2e706af704089b682ce1197152e384762f1d22968ad06928ac62c5e29eb45` and covered prototype handlers/model/export, desktop contract/client/renderer/preload/runtime, launch and verification scripts, maintained feature instructions and host/sync integration. A second pass found the unused type and no further compatible opportunity with sufficient proof. Granular operations, save-uncertainty state, explicit IPC methods, strict runtime/hash checks and bounded lifecycle/screenshot waits were retained because their contracts differ. No feature or assertion was removed.

## Branch-only findings

Two verification defects remain fixed only at `41ab77deeeaf59fe45299363ed3dadf82b87bc85`, based on unpublished branch head `afef18ba92b4ef568435e7d6535002d8abd1b2f0`. They are absent from this main publication:

- Medium: `--app` combined with an unrelated `--runtime` selected a foreign host while labeling the evidence as package verification. The fix rejects that combination and documents separate launch forms.
- Medium: `--recover` without a shared `--comb-config` creates a fresh empty object store, so there is no published genesis to recover. The fix requires explicit shared configuration, preserving valid local and remote configurations.

Root independently ran the final tests against the original branch script: 3 passed, 2 failed with the two expected missing-exception assertions. The repaired script passed all 5. A fresh source-mode control run also passed its 12 doctor checks, tab interaction and snapshot, then stopped its owned host/client processes with exit 0. Worker severity for the first finding was high; this report uses medium because the proven impact is misleading verification provenance, with no product or security failure established.

## Checks and limits

Frozen main: prototype 5/5, desktop 11/11, project typecheck, desktop build and Chromium prototype smoke passed. The desktop build produced a 2,849-byte seed and two image assets. After simplification: desktop 11/11 and typecheck passed; emitted runtime JavaScript was byte-identical, SHA-256 `5e3fc729b14a3322308e2945852be1cf0718fc6ce89ab336b37452c01529e1d6`.

An independent reviewer (Claude Opus 5, `claude-opus-5[1m]`) also rebuilt the real desktop entrypoints with `bundle: true`, the build script’s CJS/CJS/IIFE formats and `write: false`, substituting only the before/after contract source. All three bundle byte sequences matched. This comparison verifies the bundled code; it does not replace the unperformed packaged/native scenarios below. Proof receipt SHA-256: `27360dc868e97db8e93b40cc294085abed34d4f06737634e1773bdc950c480cf`.

| Bundle | Bytes, each variant | SHA-256, both variants |
| --- | --- | --- |
| `main.cjs` | 19812 | `f0f7427e225ae2c786b922a045b3aa2125e71f13dc0e2b7ebc595730675c3d8d` |
| `preload.cjs` | 715 | `b93d6f885f6a1376b636a0ffa27cb90d241b2687c00c391602b452e971a032ae` |
| `renderer.js` | 15877 | `9cab7ffa344532d8760214d37c0597c7ade02c2b92355eef414e70f5ee9d8dc5` |

Overall review remains incomplete. External S3/MinIO two-host recovery and publisher-lease handoff, packaged live-proof/manual launcher, native macOS export dialog, deliberately induced occlusion, full repository suite and two-machine/backend-outage scenarios were not rerun. Source-mode verification against an installed immutable host does not certify a packaged build. These gaps do not concern the erased unused type and are retained for follow-up. An initial build command used the wrong package filter and matched no project; it was discarded and the correct `foundation-desktop` build was run successfully.

## Portable verification evidence

Digests below describe original local log bytes; decisive excerpts are embedded so this report does not depend on access to the review machine. Reproduction commands are shown with each receipt. The branch-only scripts require the branch repair object locally; no claim is made that its unpublished SHA is available from GitHub.

### main-focused-tests.log

Command: `node --test spikes/desktop-prototype/model.test.mjs && pnpm exec vitest run packages/desktop/test --maxWorkers=1`. SHA-256: `c0e13334b2ba06b480c4072fdd4b47555d0f5b10f640e96d5934446c1c10ee43`.

```text
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1677.013917

 RUN  v4.1.10 /Users/trmd/.hive/crew/art/reviews/worktrees/foundation-2026-09-10


 Test Files  3 passed (3)
      Tests  11 passed (11)
   Start at  04:25:35
   Duration  6.26s (transform 1.12s, setup 0ms, import 2.14s, tests 689ms, environment 1ms)

```

### main-desktop-build.log

Command: `pnpm --filter foundation-desktop build`. SHA-256: `6300e792d79c7f72ceeb880eb95fc93a815d04397eeecec64885374b5759c4d5`.

```text

> foundation-desktop@0.1.0 build /Users/trmd/.hive/crew/art/reviews/worktrees/foundation-2026-09-10/packages/desktop
> node scripts/build.mjs

Desktop built. Seed 2849 bytes; 2 bundled image assets.
```

### main-simplification-focused-tests.log

Command: `pnpm exec vitest run packages/desktop/test --maxWorkers=1`. SHA-256: `7615b09ca41453e57d3f1127f508a1fa469a4246c81a133c3e9f1f2aef05267d`.

```text

 RUN  v4.1.10 /Users/trmd/.hive/crew/art/reviews/worktrees/foundation-2026-09-10


 Test Files  3 passed (3)
      Tests  11 passed (11)
   Start at  04:29:11
   Duration  5.34s (transform 759ms, setup 0ms, import 1.34s, tests 685ms, environment 2ms)

```

### main-simplification-typecheck.log

Command: `pnpm typecheck`. SHA-256: `fd26f7cca5803fa1db90c171f3c0ce4881e6f76d3e9425c4b5d8a207bd8e2205`.

```text

> foundation@0.0.1 typecheck /Users/trmd/.hive/crew/art/reviews/worktrees/foundation-2026-09-10
> tsc --noEmit

```

### root-control-red.log

Reproduction: extract `packages/desktop/scripts/control-foundation.mjs` from `afef18ba92b4ef568435e7d6535002d8abd1b2f0` and the sibling test from `41ab77deeeaf59fe45299363ed3dadf82b87bc85` into the same isolated scratch directory; run `node --test control-foundation.test.mjs` there. SHA-256: `5f782a39a72e9472666ccbce5c72f50e4b45b76f14e0118718343730db49a660`.

```text
✔ rejects misspelled target options and invalid clients before touching an instance (74.006ms)
✖ shared-document launches take a Comb configuration, document id and recover switch (9.83075ms)
✔ stored-state assertions distinguish missing values, null, arrays and inherited properties (1.093459ms)
✔ bounded lifecycle fails on missing exit acknowledgement (114.306875ms)
✖ launch requires explicit source runtime; help is machine readable (14.163542ms)
ℹ tests 5
ℹ suites 0
ℹ pass 3
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4482.688625

✖ failing tests:

test at ../../../../../private/var/folders/y2/lgjk786x2qz6s_gt20x091vc0000gn/T/art-foundation-control-red-j964_vsd/packages/desktop/scripts/control-foundation.test.mjs:14:1
✖ shared-document launches take a Comb configuration, document id and recover switch (9.83075ms)
  AssertionError [ERR_ASSERTION]: Missing expected exception.
      at TestContext.<anonymous> (file:///private/var/folders/y2/lgjk786x2qz6s_gt20x091vc0000gn/T/art-foundation-control-red-j964_vsd/packages/desktop/scripts/control-foundation.test.mjs:19:10)
      at Test.runInAsyncScope (node:async_hooks:226:14)
      at Test.run (node:internal/test_runner/test:1201:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:831:18)
      at Test.postRun (node:internal/test_runner/test:1330:19)
      at Test.run (node:internal/test_runner/test:1258:12)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: /requires --comb-config/,
    operator: 'throws',
    diff: 'simple'
  }

test at ../../../../../private/var/folders/y2/lgjk786x2qz6s_gt20x091vc0000gn/T/art-foundation-control-red-j964_vsd/packages/desktop/scripts/control-foundation.test.mjs:36:1
✖ launch requires explicit source runtime; help is machine readable (14.163542ms)
  AssertionError [ERR_ASSERTION]: Missing expected exception.
      at TestContext.<anonymous> (file:///private/var/folders/y2/lgjk786x2qz6s_gt20x091vc0000gn/T/art-foundation-control-red-j964_vsd/packages/desktop/scripts/control-foundation.test.mjs:38:10)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:831:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: /cannot be combined/,
    operator: 'throws',
    diff: 'simple'
  }
```

### root-control-green.log

At `41ab77deeeaf59fe45299363ed3dadf82b87bc85`, command: `node --test packages/desktop/scripts/control-foundation.test.mjs`. SHA-256: `2c50d0b76a04be709a16e61a3fa00ada5be17b231994071f73e550404089823d`.

```text
✔ rejects misspelled target options and invalid clients before touching an instance (14.740916ms)
✔ shared-document launches take a Comb configuration, document id and recover switch (0.768542ms)
✔ stored-state assertions distinguish missing values, null, arrays and inherited properties (4.608083ms)
✔ bounded lifecycle fails on missing exit acknowledgement (55.736833ms)
✔ launch requires explicit source runtime; help is machine readable (17.498167ms)
ℹ tests 5
ℹ suites 0
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2441.140417
```

### root-type-erasure-proof.json

Reproduction: transform the `contract.ts` blobs at the frozen base and `af20a49366c554838287fe15b116a962beae04f7` using the desktop package’s esbuild `transformSync` with `{ loader: "ts", format: "esm", target: "es2022" }`; compare the returned `code` bytes. SHA-256: `75a54a129153431a02b19a4fea28f437fc0bd479d6fb3b599f1cec22b56fac62`.

```text
{
  "path": "packages/desktop/src/contract.ts",
  "baseline": "0b80e87b9e4f7dc32d151d7a689e936e20a45518",
  "emittedJavaScriptByteIdentical": true,
  "sha256": "5e3fc729b14a3322308e2945852be1cf0718fc6ce89ab336b37452c01529e1d6",
  "note": "Internal exported type of private application package; esbuild JS output unchanged. Initial TypeScript API probe failed because installed typescript is a TS7 CLI shim; no result was claimed."
}
```

## Exact reviewed source set

For each source SHA, regenerate its recorded raw diff with `git diff --binary --full-index --no-ext-diff --no-renames SHA^ SHA`. The digest is over those bytes.

| SHA | Frozen-main reachability | Raw diff SHA-256 |
| --- | --- | --- |
| `afef18ba92b4ef568435e7d6535002d8abd1b2f0` | branch only | `bc6c36a61f69c8a6122696f182afff82c116448db3af5c65f4733f6b54682c0e` |
| `5db1a4aa8bd2faa5aab2c0507c1230033f6747c7` | branch only | `5a6f66e160721634cc2b2a67b39b0caa064a8ebc2c86f47cf9038dabd01a521b` |
| `b02b7effc47acf21492c9e5633ae94d7ac5c0eba` | branch only | `331b405b0c215499141739c2efd2779ec47d65b3766b5e7b4fc458f38921c885` |
| `0b80e87b9e4f7dc32d151d7a689e936e20a45518` | main | `9d6a12e467dd857ccb950fd32155d9596e83f004254965cbd7d6e11b72f46134` |
| `8102c5133fa0b7ad84a0fd7ad7a921f79f4662a7` | main | `652d858a130aa15d61745211a33f08c3a9e97794213a7765e14a6b2fe2c3dc3e` |
| `a489c0a9627b1f51fec13a7e5cb33ac6cdff2061` | main | `bea26ad89ffb90ea5859e996a60b99acf1c23772ceee3fc8793a126f315ca8f7` |
| `01d745b06d59128f0e299f2e6193476041f44008` | main | `b68131cc7ec4cb90f72aeb89b1a71d6939263afbee276f4bf99ff59d2d5dce3f` |
| `3943990ef1d86d7d89d293eb680a6b1a49f65810` | main | `606f2f15a2a25b1f5176310fef09f5adb3a41de427bc9675b662489407e905be` |
| `3163060ffd6903395d6cd51df4b7c9f957a51ac9` | main | `4545dc17ed1825fce1b65ed6c1b7bc6f26e73a274bdf2fcb9c81a06af11b76e5` |
| `4ca0d2cb1e23b15588f6d417b1659abf4968c2d8` | main | `38ac47af16a0e7abacabc256e949a85a0fc56fb42bf29192ba22c6d57d4196e3` |
| `b7b85b17d49fc385f1abd7aa894868f51624aa24` | main | `bd1961fcede1e33dbd213687f6c8cfacade126811f65d4743c8e46801768509c` |
| `7fedb51efb6c55db18f24bf04a8eb83ccef94a1f` | main | `ad174c91fbed9138ee3f0c2ecfb8abfe43419a1f86f9e09d358b44d94e07cc25` |
| `f718ce5dda5b5680fed7af072b97f78af6c639f9` | main | `521f6c6483c868011f32a4bcf07bfa44ab5c3f25c75a93a921cc456e6950598a` |
| `257169b0b334e10456bb15cd3b7a862730116b05` | main | `04b48200ae82d5d7fabd9295277c7c7a9a9842d2e9bdcc2c72589fd4b992cb6c` |
| `3be56aa8a083307f1a89651a270287e4e883e988` | main | `b160d6868e1d8ca1a461f096b057f91e1a9c2d0d2565af8421796143907f209c` |
| `f79eaefca0085306f2fbd83b86c763389854d310` | main | `377fdc75f818023262c1f069bdf0ff223a8aeab3c974ce9736c20617b3ee0b92` |
| `0483d992dcb4bbb3d9814ee4c31669279cf0478a` | main | `e4e0d1175ddc21f45f5502828e5390734eb0442b717a8d1bfa7bc9d434e56ef2` |
| `f8f278ccb014166396c1ac47db46f100af8a501f` | main | `e8010442d26e2e13aa98c670eb7bd25e778ed8c1fa9022c5d63768dfb5f57603` |
| `c567b0a35fe1616598f4fd70d9069107e8145b8c` | main | `50fa02965bad59e6d0c56e7f79f3657ebf97bf174ee2107441e8a1f3d5ea6b31` |
| `6e2355ecda7bd5e63c99aaf41ea36c5d97f54353` | main | `76ab8841c2008db904e99d1344e196a8e36b04d9d7559ddb5f07a664a1654c59` |
| `dc83269372af51b966c31de4869bac3987b999f6` | main | `6a7e0c857c4f5f8a897d617536358d499005569be49e1444116713318e8ce2bf` |
| `356c6805cc5126c19fd86495c090054c16920ce0` | main | `f8820cd7c1ac443271d30ea310d7e81c22cd4179a1373a0895e93179573297e1` |
| `ad7f99d97089f2ce346ef49efa6b1d1abd469638` | branch only | `9d6a12e467dd857ccb950fd32155d9596e83f004254965cbd7d6e11b72f46134` |
| `b19d0f51d30f83fc5cae708f36b8294acad96f6f` | branch only | `652d858a130aa15d61745211a33f08c3a9e97794213a7765e14a6b2fe2c3dc3e` |
| `7d258b8d65dba19c4f0fa0b6be3f13af211d3352` | branch only | `bea26ad89ffb90ea5859e996a60b99acf1c23772ceee3fc8793a126f315ca8f7` |
| `ece99795e18ee9a1df55b90ba3a0ca101e7605ea` | branch only | `b68131cc7ec4cb90f72aeb89b1a71d6939263afbee276f4bf99ff59d2d5dce3f` |
| `2c1e0f4d1e95748cf93c9c3d6fafaaf7e88fb6e8` | branch only | `606f2f15a2a25b1f5176310fef09f5adb3a41de427bc9675b662489407e905be` |
| `982adf44fccf176f8bbb1518344a68512bbff463` | branch only | `4545dc17ed1825fce1b65ed6c1b7bc6f26e73a274bdf2fcb9c81a06af11b76e5` |
| `483b87f4f5e0263739523a58b7dd3c4e3cc5a3ed` | branch only | `38ac47af16a0e7abacabc256e949a85a0fc56fb42bf29192ba22c6d57d4196e3` |
| `f9cacf4b735bb383656ce0926ac1f38d5d884173` | branch only | `bd1961fcede1e33dbd213687f6c8cfacade126811f65d4743c8e46801768509c` |
| `058a54f743c1816784beb89982fb7d8981e35a52` | branch only | `ad174c91fbed9138ee3f0c2ecfb8abfe43419a1f86f9e09d358b44d94e07cc25` |
| `0f089e3d733c0cb4147e625817cc6bc2aa0de142` | branch only | `521f6c6483c868011f32a4bcf07bfa44ab5c3f25c75a93a921cc456e6950598a` |
| `9ded152bd7e2943aa648f931816d096b809a4974` | branch only | `04b48200ae82d5d7fabd9295277c7c7a9a9842d2e9bdcc2c72589fd4b992cb6c` |
| `424d899ec5084a098f09762e103420cd59762f31` | branch only | `b160d6868e1d8ca1a461f096b057f91e1a9c2d0d2565af8421796143907f209c` |
| `e570d6c434c9ad3d5cc6932ab68181ba0df5eafc` | branch only | `377fdc75f818023262c1f069bdf0ff223a8aeab3c974ce9736c20617b3ee0b92` |
| `ef34d4c5ce12de737a580bad4fd3e4a1f7b1e81a` | branch only | `e4e0d1175ddc21f45f5502828e5390734eb0442b717a8d1bfa7bc9d434e56ef2` |
| `b8f08f0a4ad7f09e2da0385335758145607ee877` | branch only | `e8010442d26e2e13aa98c670eb7bd25e778ed8c1fa9022c5d63768dfb5f57603` |
| `98e73889e8873f76acb0fb0d90e816b560b7a62c` | branch only | `50fa02965bad59e6d0c56e7f79f3657ebf97bf174ee2107441e8a1f3d5ea6b31` |
| `6a0209e1e8ca48c15ff13ae18c74209b3c406a23` | branch only | `76ab8841c2008db904e99d1344e196a8e36b04d9d7559ddb5f07a664a1654c59` |
| `e8478875267b8630e93f3953f5edb906506d1252` | branch only | `6a7e0c857c4f5f8a897d617536358d499005569be49e1444116713318e8ce2bf` |

Prepared by Art (Codex); root independently checked the type-erasure and branch guard proofs. Cross-model trail review is tracked separately in Art’s local run record.
