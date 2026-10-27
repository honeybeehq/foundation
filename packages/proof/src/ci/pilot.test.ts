import { test, expect } from "vitest";
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { pilotPolicy, identity } from "./pilot.ts";

test("multi-component pilot binds HTML/head/environment and writes distinct report paths", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fdn-pilot-"));
  try {
    await mkdir(path.join(dir, ".foundation"));
    const cases = [];
    for (const [name, states, view] of [
      ["keycap", ["default"], "160x60@1"],
      ["inbox-row", ["selected", "failed"], "340x100@1"],
    ] as const) {
      const first = JSON.parse(
        await readFile(
          `packages/proof/fixtures/components/${name}/captures/${name}/${states[0]}/${view}/design/meta.json`,
          "utf8",
        ),
      );
      const links = {
        schema: "fdn-links/0",
        designFile: first.file,
        designHead: first.designHead,
        designHtmlSha256: first.htmlSha256,
        binding: first.binding,
        viteConfig: "fixture.ts",
        harness: "harness.ts",
        fontPolicy: first.fontPolicy,
        fonts: first.fontAssets,
        browserVersion: first.browserVersion,
        platform: first.platform,
        artboards: [
          {
            id: name,
            component: "fixture.tsx#View",
            designNode: "root",
            viewport: first.viewport,
            states: states.map((name) => ({
              name,
              fixture: "fixture.ts#data",
              designState: "default",
            })),
            components: [],
          },
        ],
      };
      const file = `.foundation/links-${name}.json`;
      await writeFile(path.join(dir, file), JSON.stringify(links));
      cases.push({ links: file });
      for (const state of states) {
        const rel = `${name}/${state}/${view}`;
        await mkdir(path.join(dir, "baseline", rel), { recursive: true });
        await cp(
          `packages/proof/fixtures/components/${name}/captures/${rel}/design`,
          path.join(dir, "baseline", rel, "design"),
          { recursive: true },
        );
        await mkdir(path.join(dir, "captures", rel), { recursive: true });
        await cp(
          `packages/proof/fixtures/components/${name}/captures/${rel}/code`,
          path.join(dir, "captures", rel, "code"),
          { recursive: true },
        );
      }
    }
    await writeFile(
      path.join(dir, ".foundation/pilot.json"),
      JSON.stringify({ schema: "fdn-pilot/0", cases }),
    );
    await writeFile(path.join(dir, "tool.tgz"), "test package");
    await writeFile(
      path.join(dir, "source.json"),
      JSON.stringify({
        foundationCommit: "f".repeat(40),
        cliSha256: "a".repeat(64),
      }),
    );
    const policy = await pilotPolicy(
      dir,
      ".foundation/pilot.json",
      "baseline",
      "tool.tgz",
      path.join(dir, "source.json"),
    );
    expect(policy.required).toHaveLength(3);
    expect(
      new Set(Object.values(policy.baseline!.bindings!).map((b) => b.head))
        .size,
    ).toBe(2);
    for (const scope of policy.required)
      expect(
        policy.captureEnvironments![identity(scope)]!.browserVersion,
      ).toBeTruthy();
    await writeFile(path.join(dir, "policy.json"), JSON.stringify(policy));
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", [
      "-C",
      dir,
      "-c",
      "user.name=Pilot test",
      "-c",
      "user.email=pilot@example.test",
      "commit",
      "--allow-empty",
      "-qm",
      "Fixture",
    ]);
    const invoke = () =>
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "packages/proof/src/ci/cli.ts",
          "check",
          "--code",
          dir,
          "--pilot",
          ".foundation/pilot.json",
          "--baseline",
          path.join(dir, "baseline"),
          "--captures",
          path.join(dir, "captures"),
          "--out",
          path.join(dir, "output"),
          "--policy",
          path.join(dir, "policy.json"),
          "--mode",
          "advisory",
          "--run",
          "pilot-test.1",
        ],
        { encoding: "utf8", stdio: "pipe", maxBuffer: 2 * 1024 * 1024 },
      );
    expect(invoke()).toContain("advisory mode");
    for (const scope of policy.required) {
      const rel = `${scope.artboard}/${scope.state}/${scope.viewport.width}x${scope.viewport.height}@${scope.viewport.dpr}`;
      const r = JSON.parse(
        await readFile(
          path.join(dir, "output", rel, "drift-report.json"),
          "utf8",
        ),
      );
      expect(r.artboard).toBe(scope.artboard);
      expect(r.state).toBe(scope.state);
    }
    const index = JSON.parse(
      await readFile(path.join(dir, "output/review-index.json"), "utf8"),
    );
    expect(index.candidates.length).toBeGreaterThan(0);
    expect(
      index.candidates.every((c: any) => c.classification === "product"),
    ).toBe(true);
    const summary = await readFile(path.join(dir, "output/summary.md"), "utf8");
    expect(summary).toContain("Manual review");
    expect(summary).toContain("Outside product review");
    const firstFile = path.join(dir, cases[0]!.links),
      links = JSON.parse(await readFile(firstFile, "utf8"));
    links.designHtmlSha256 = "0".repeat(64);
    await writeFile(firstFile, JSON.stringify(links));
    await expect(
      pilotPolicy(
        dir,
        ".foundation/pilot.json",
        "baseline",
        "tool.tgz",
        path.join(dir, "source.json"),
      ),
    ).rejects.toThrow("Baseline differs");
    expect(() => invoke()).toThrow("Pilot links differ");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
