# Third-party components

PalmierWin is an independent implementation. It is not affiliated with Palmier, Inc., and does not contain Palmier application source code or its hosted services. Public product documentation and screenshots were used as functional and visual references. The Palmier name and trademarks belong to their respective owners.

Electron is distributed under the MIT license and contains Chromium, Node.js, and other components. Its license and Chromium notices are included in the installed application distribution by Electron Builder. See https://github.com/electron/electron.

GitHub updates use `electron-updater` 6.8.11 (MIT), from https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater. Version comparisons use `semver` 7.7.3 (ISC), from https://github.com/npm/node-semver. Dependency license files are retained in the packaged application.

The bundled FFmpeg executable comes from `ffmpeg-static` 5.2.0, using the binaries published by https://github.com/eugeneware/ffmpeg-static/releases. Its executable license and build README are included beside the binary in `resources/app.asar.unpacked/node_modules/ffmpeg-static`. FFmpeg is a separate executable; PalmierWin invokes it as a process. Review the bundled license for the exact build's GPL terms, source links, and redistribution requirements. FFmpeg's source is available at https://ffmpeg.org/download.html and the corresponding build source is linked from the binary release.

The ffprobe executable comes from `ffprobe-static` 3.1.0. Its project, source, and binary provenance are documented at https://github.com/joshwnj/ffprobe-static. Licenses supplied with that dependency are retained in the packaged application.

All demo artwork and audio in `assets/demo` were generated for PalmierWin using `scripts/generate-demo.py`. No Palmier screenshots, videos, customer content, or stock media are bundled as editable demo media.
