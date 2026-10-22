import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { build, Platform, Arch } = require("electron-builder");

// electron-builder 26.15.3 normally runs a generated NSIS stub through Wine
// to extract its uninstaller on Linux. Its own byte-for-byte NSIS extractor
// (also used for macOS builds) does the same work without running Windows code.
// Keep the builder version pinned: these two internal APIs are version-specific.
if (process.platform === "linux") {
  const { WineVmManager } = require("app-builder-lib/out/vm/WineVm");
  const {
    UninstallerReader,
  } = require("app-builder-lib/out/targets/nsis/nsisUtil");
  const original = WineVmManager.prototype.exec;
  WineVmManager.prototype.exec = function (file, args, options) {
    if (
      path.basename(file).startsWith("PalmierWin-") &&
      file.endsWith("-Setup.exe") &&
      !args.length
    ) {
      const output = path.join(
        path.dirname(file),
        `${path.basename(file, "exe")}__uninstaller.exe`,
      );
      return UninstallerReader.exec(file, output);
    }
    return original.call(this, file, args, options);
  };
}

const prepackagedIndex = process.argv.indexOf("--prepackaged");
if (prepackagedIndex >= 0 && !process.argv[prepackagedIndex + 1])
  throw new Error("Provide the prepackaged app directory.");
await build({
  // Packaging must not implicitly publish when running on a CI runner.
  publish: "never",
  targets: Platform.WINDOWS.createTarget(
    process.argv.includes("--installer-only") ? ["nsis"] : ["nsis", "portable"],
    Arch.x64,
  ),
  ...(prepackagedIndex >= 0
    ? { prepackaged: path.resolve(process.argv[prepackagedIndex + 1]) }
    : {}),
});
