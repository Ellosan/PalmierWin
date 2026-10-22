import { createHash } from "node:crypto";
import { copyFile, readFile, writeFile } from "node:fs/promises";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
const names = ["Setup", "Portable"].map(
  (target) => `PalmierWin-${version}-x64-${target}.exe`,
);
const checksums = [];
for (const name of names) {
  const data = await readFile(`release/${name}`);
  if (data[0] !== 0x4d || data[1] !== 0x5a) {
    throw new Error(`Not a Windows executable: ${name}`);
  }
  checksums.push(`${createHash("sha256").update(data).digest("hex")}  ${name}`);
}
await writeFile("release/SHA256SUMS.txt", `${checksums.join("\n")}\n`);
await copyFile("docs/images/PalmierWin-preview.png", "release/PalmierWin-preview.png");
await writeFile(
  "release/README.txt",
  `PalmierWin ${version} — Windows x64 preview\n\nRun Setup.exe to install, or Portable.exe to run without installation.\nThese builds are unsigned. Windows 10/11 x64 is the intended target.\n\nCtrl I imports media. Ctrl S saves a project. Export renders MP4 or MOV.\nAI chat requires your own provider; MCP uses http://127.0.0.1:19789/mcp.\n\nFull Palmier Pro parity is incomplete.\nFeatures and limitations: https://github.com/Ellosan/PalmierWin/blob/v${version}/docs/PARITY.md\nSource and instructions: https://github.com/Ellosan/PalmierWin\n`,
);
console.log(`Prepared ${names.length} Windows executables, checksums and release information.`);
