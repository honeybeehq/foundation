# Art nightly foundation evidence, 2026-09-07

These excerpts and SHA-256 digests make the local verification record readable in the repository. Each digest identifies the original complete log. Excerpts omit routine progress output. Exit codes are recorded by the command runner; an empty lint log alone is not treated as proof.

Source and fix revisions below refer to the reviewed feature branches where indicated. Publishing this document does not publish those feature branches or claim a live UI/model run.

- Desktop export omitted bundled image assets. Source `0aace37b270a0bd0a070e35030a41ff2611a0cad`; repair `92efcb089309857a07b949a90be5d85f1ca5694c`. fixed on local branch.

## foundation-export-focused-green.log

Command: `pnpm vitest run packages/desktop/test/host-client.test.ts`

Recorded exit: `0`. Original bytes: `253`. SHA-256: `cc9de0ef9363cf5a82ff5e7c4d59b6e2da052d8155aceb6d0a3cbcd099bb2b87`.

```text
 RUN  v4.1.10 /Users/trmd/.hive/crew/art/reviews/worktrees/foundation-2026-09-07

 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  05:16:53
   Duration  1.36s (transform 164ms, setup 0ms, import 312ms, tests 356ms, environment 0ms)

```

## foundation-export-affected-tests.log

Command: `pnpm vitest run packages/desktop/test packages/host/test/service.test.ts --maxWorkers=2`

Recorded exit: `0`. Original bytes: `253`. SHA-256: `ae2f28f3ef6f8953dd123a0ce4d6f4629f184baf5dc519f7efe74e1e52206489`.

```text
 RUN  v4.1.10 /Users/trmd/.hive/crew/art/reviews/worktrees/foundation-2026-09-07

 Test Files  4 passed (4)
      Tests  21 passed (21)
   Start at  05:17:36
   Duration  3.23s (transform 1.04s, setup 0ms, import 1.99s, tests 1.65s, environment 1ms)

```

## foundation-export-typecheck.log

Command: `pnpm typecheck`

Recorded exit: `0`. Original bytes: `113`. SHA-256: `9d8a9f0006d473360b37cd0c992958a0694f9f13b7380f78dbbb21d63528188d`.

```text
> foundation@0.0.1 typecheck /Users/trmd/.hive/crew/art/reviews/worktrees/foundation-2026-09-07
> tsc --noEmit
```

## foundation-export-desktop-build.log

Command: `pnpm --dir packages/desktop build`

Recorded exit: `0`. Original bytes: `200`. SHA-256: `a75f32e55bafb39736c66489def817a8ccfcd78ba99f53a74401c6db3ba8674b`.

```text
> foundation-desktop@0.1.0 build /Users/trmd/.hive/crew/art/reviews/worktrees/foundation-2026-09-07/packages/desktop
> node scripts/build.mjs
Desktop built. Seed 2849 bytes; 2 bundled image assets.
```

## foundation-export-host-build.log

Command: `node scripts/build-host.mjs`

Recorded exit: `0`. Original bytes: `118`. SHA-256: `866dd83ced7177efa8a7081c0e7e7f8871f1acaeb2caa0245199b47d068fa3a9`.

```text
Host bundle: /Users/trmd/.hive/crew/art/reviews/worktrees/foundation-2026-09-07/dist/host
Runtime packages: loro-crdt
```

## foundation-export-worker-red.log

Command: `Focused regression reproduction before the repair`

Recorded exit: `expected failing test`. Original bytes: `1234`. SHA-256: `56995686e7acd5295ed3d3c84e79c5d5f65156ddee359e5a04bac056cf943317`.

```text

 ❯ packages/desktop/test/host-client.test.ts (7 tests | 1 failed) 242ms
     × completes a host export with the bundled assets referenced by its HTML 37ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  packages/desktop/test/host-client.test.ts > main-process HTTP boundary > completes a host export with the bundled assets referenced by its HTML
Error: ENOENT: no such file or directory, open '/var/folders/y2/lgjk786x2qz6s_gt20x091vc0000gn/T/foundation-desktop-export-0rWSq7/export/assets/cover.jpeg'
 ❯ packages/desktop/test/host-client.test.ts:91:12
     92|     expect(await readFile(chain, 'utf8')).toBe('unchanged-chain')
     93|   })
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
   Start at  05:14:24
   Duration  1.05s (transform 119ms, setup 0ms, import 243ms, tests 242ms, environment 0ms)

```
