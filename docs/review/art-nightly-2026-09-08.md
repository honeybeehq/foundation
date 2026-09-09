# Art nightly review: foundation, 2026-09-08

Window: 2026-09-08 00:00 to 2026-09-09 00:00 Europe/Oslo. Frozen main `9b927604435aeea24342f9e3ff1120f0a66f252e`; branch review head `7ef08acb715425c2f7f879b4cce639a63546aefb`.

The prior desktop export repair still copies only referenced bundled assets, confines returned paths, refuses collisions, fsyncs output and reports missing assets as errors. HTML and chain payloads remain unchanged. No new regression found.

Reviewed exact commits:

- `9b927604435aeea24342f9e3ff1120f0a66f252e`: Full report diff reviewed; historical scope and portable evidence verified against original artifacts. Full-diff SHA-256 `8080171739bc3e6df4069a33648f011db0f588624019021c5c2b38627522a67e`.
- `b345a0b409bc21af15bf9233346640feca3560b4`: Full report diff reviewed; historical scope and portable evidence verified against original artifacts. Full-diff SHA-256 `2ad731a8952527d140d9374d5b8619480a16c6872f30440b4687b95a31428b8b`.
- `7ef08acb715425c2f7f879b4cce639a63546aefb`: Full report diff reviewed; historical scope and portable evidence verified against original artifacts. Full-diff SHA-256 `44178169cc3be7faa1a1e51defb04ae6c6c04a54ba1f2d01ae3e1b6c2c6645f4`.
- `92efcb089309857a07b949a90be5d85f1ca5694c`: The prior desktop export repair still copies only referenced bundled assets, confines returned paths, refuses collisions, fsyncs output and reports missing assets as errors. HTML and chain payloads remain unchanged. No new regression found. Full-diff SHA-256 `75e92e62205a0f22befdb5b6058c625d8c6b4ab7e292ad3427dcaee51f2ef1f9`.
- `8abd1a32f2ad07f274eba200a18f3203ffbd8b3f`: Intentional failing regression test is superseded by the following branch repair; fresh tests pass at the exact reviewed branch head. Full-diff SHA-256 `b58d91c1746b61f76b2b16d60a3fb00748bf8aefdbaee4f4ac46b45ad28e7582`.

Required radically-simplify pass covered:

- `packages/desktop/src/contract.ts`
- `packages/desktop/src/host-client.ts`
- `packages/desktop/src/main.ts`

- Retained: this changes output, copies unused resources and weakens the bounded export contract.
- Retained: exclusive creation, partial-failure reservation and durability are independent observable requirements.
- Retained: the main-process host response boundary is authoritative and independently callable. Renderer validation cannot replace it.

Skill SHA-256 `67e2e706af704089b682ce1197152e384762f1d22968ad06928ac62c5e29eb45`. The second pass found no further compatible, proven reduction. No simplification changes were made.

Fresh desktop tests pass 15/15; desktop plus host-service tests pass 21/21. Typecheck and desktop build pass. The status-report host rerun passed 56/58 with two five-second timeouts; all 25 tests in that file pass on the isolated rerun. SQLite contention did not recur. The host and contention paths are blob-identical to the accepted pre-repair branch. No new packaged two-client or native UI acceptance is claimed. The feature and export repair remain branch-only.

Verification excerpts below identify complete local logs by SHA-256. They are portable evidence, with exit status from the command runner.

## foundation-desktop-tests

Command: `pnpm exec vitest run packages/desktop/test`. Exit `0`. Log SHA-256 `a439a15b457ffe066f05a6da03e2c4ed4684df6c6e295b83185c78b2277dc14e`.

```text
 Test Files  3 passed (3)
      Tests  15 passed (15)
```

## foundation-affected-tests

Command: `pnpm exec vitest run packages/desktop/test packages/host/test/service.test.ts --maxWorkers=2`. Exit `0`. Log SHA-256 `81f63f4ffa9bf85c8847877aebdd5a68864dd7d3022e7096a85bcf3a684a8d01`.

```text
 Test Files  4 passed (4)
      Tests  21 passed (21)
```

## foundation-typecheck

Command: `pnpm typecheck`. Exit `0`. Log SHA-256 `af99c6706f47214edfd2fdafe97d19eb689b095a2f95315887eeb273dc1f6183`.

```text

> foundation@0.0.1 typecheck /Users/trmd/.hive/crew/art/reviews/worktrees/foundation-2026-09-08-root
> tsc --noEmit

```

## foundation-desktop-build

Command: `pnpm --dir packages/desktop build`. Exit `0`. Log SHA-256 `05cd7603565c1a4d02fee2e73a8bcf621732d745a1658f9eb7f6e2e7bed19c63`.

```text
Desktop built. Seed 2849 bytes; 2 bundled image assets.
```

## foundation-reported-host-check

Command: `pnpm exec vitest run packages/host/test packages/cli/test/host.test.ts --maxWorkers=2`. Exit `1`. Log SHA-256 `a7617f68a2344b34091db5afc9b16166f5f0ec0d69eb135e4957dcf273023808`.

```text
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
Error: Test timed out in 5000ms.
Error: Test timed out in 5000ms.
 Test Files  1 failed | 5 passed (6)
      Tests  2 failed | 56 passed (58)
```

## foundation-host-timeout-recheck

Command: `pnpm exec vitest run packages/host/test/comb-client.test.ts --maxWorkers=1`. Exit `0`. Log SHA-256 `b7d6bbf785ab03f568a33a900a186b0a11b52a231c1546bfef7a7110130ecd11`.

```text
 Test Files  1 passed (1)
      Tests  25 passed (25)
```

This main commit publishes the review only. No unfinished feature branch, shared working-tree changes, deployment or release is included.
