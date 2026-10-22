import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
async function walk(dir) {
  const out = [];
  for (const f of await readdir(dir, { withFileTypes: true })) {
    const p = `${dir}/${f.name}`;
    if (f.isDirectory()) out.push(...(await walk(p)));
    else if (/\.(mjs|cjs)$/.test(f.name)) out.push(p);
  }
  return out;
}
let failed = false;
for (const file of await walk("src")) {
  const r = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  if (r.status) {
    console.error(r.stderr);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log("All source files passed JavaScript syntax checks.");
