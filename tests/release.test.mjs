import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

test("Beta release preparation exposes a latest manifest and rejects mismatched versions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "palmierwin-release-"));
  try {
    const version = "0.1.2-beta.1";
    await mkdir(path.join(root, "release"));
    await mkdir(path.join(root, "docs", "images"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ version }),
    );
    await writeFile(
      path.join(root, "docs", "images", "PalmierWin-preview.png"),
      "preview fixture",
    );
    await writeFile(
      path.join(root, "release", "beta.yml"),
      `version: ${version}\n`,
    );
    for (const target of ["Setup", "Portable"])
      await writeFile(
        path.join(root, "release", `PalmierWin-${version}-x64-${target}.exe`),
        Buffer.from([0x4d, 0x5a, 0, 0]),
      );
    const script = fileURLToPath(
      new URL("../scripts/prepare-release.mjs", import.meta.url),
    );
    const result = spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      await readFile(path.join(root, "release", "latest.yml"), "utf8"),
      `version: ${version}\n`,
    );
    assert.match(
      await readFile(path.join(root, "release", "SHA256SUMS.txt"), "utf8"),
      /PalmierWin-0\.1\.2-beta\.1-x64-Setup\.exe/,
    );
    await writeFile(
      path.join(root, "release", "beta.yml"),
      "version: 0.1.2-beta.10\n",
    );
    const rejected = spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
    });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /manifest version does not match/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
