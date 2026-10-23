# PalmierWin

An independent Windows video editor based on Palmier Pro's public workspace and agent-editing workflow. It opens with an original, editable coastal sample project.

This is a working implementation, **not verified full Palmier parity**. See [the feature comparison](docs/PARITY.md) for capabilities and remaining differences.

Download the installer or portable Windows app from [GitHub Releases](https://github.com/Ellosan/PalmierWin/releases). The initial release is an unsigned Windows preview.

## Run on Windows

Install Node.js 22 or newer, then run in PowerShell:

```powershell
npm ci
npm start
```

Build an installer and portable app:

```powershell
npm run dist:win
```

The executables appear in `release/`. FFmpeg and ffprobe are bundled. You do not need a separate FFmpeg installation. `PALMIERWIN_FFMPEG_PATH` and `PALMIERWIN_FFPROBE_PATH` can override them with absolute executable paths.

For Linux cross-builds, first install the Windows FFmpeg binary with `npm_config_platform=win32 npm_config_arch=x64 node node_modules/ffmpeg-static/install.js`. The pinned build helper uses Electron Builder's NSIS uninstaller extractor to build unsigned installers without Wine.

The [Windows build workflow](.github/workflows/windows.yml) also produces downloadable NSIS and portable artifacts on pushes, pull requests, and manual runs. Pushing a version tag such as `v0.1.1` publishes a preview release with those files after a successful Windows build. The tag must match `package.json`, and release notes must exist at `docs/releases/<tag>.md`. A manual run can also publish a matching tag using the `release_tag` input. Builds are unsigned.

## Editing

- Import media with **Ctrl I**, the media panel, or file drop. Double-click media or drag it onto a compatible track.
- Select a timeline clip to open its inspector. Drag clip edges to trim, use **Ctrl K** to split at the playhead, and **Shift Delete** to ripple delete.
- Use **T** for a title, **M** for a marker, **Space** for playback, and arrow keys for frame stepping. **Ctrl Z** undoes both manual edits and agent edits.
- Use the timeline **+** button for an alternate cut; the adjacent menu duplicates the current cut. Project media is shared between timelines.
- **Chat** opens the left agent dock. Local quick edits work immediately. For AI chat, configure a tool-capable OpenAI-compatible provider in Settings. Keys are stored with Windows encryption. Requests use your provider account.
- **Export** renders a video through FFmpeg. Choose H.264, H.265, or ProRes. **Ctrl S** saves a `.palmierwin` project; keep its media files in place. Every change also updates local recovery autosave.

## AI providers and external agents

### NVIDIA Nemotron

New desktop installations default to `https://integrate.api.nvidia.com/v1` and
`nvidia/nemotron-3-ultra-550b-a55b`. Enter your NVIDIA API key in Settings; Windows
encrypts the saved key. Existing saved provider settings are preserved.

For development, copy `.env.example` to `.env.local` and set `NVIDIA_API_KEY`.
`npm start` loads that file only in development. It is ignored by Git and excluded
from packaged applications. An environment key is used only with NVIDIA's exact
API endpoint, never with another provider. Removing an environment key in Settings
disables it for the current session; delete it from `.env.local` to remove it permanently.

NVIDIA requests use streaming, thinking enabled, temperature 1, top-p 0.95, and a
16,384-token output limit. The editor assembles the response before displaying the
answer or executing complete tool calls. Requests have a ten-minute timeout;
NVIDIA can still reject or time out requests during high traffic.

### MCP clients

Keep PalmierWin open, then configure a Streamable HTTP MCP client:

```powershell
codex mcp add palmierwin --url http://127.0.0.1:19789/mcp
```

Or:

```powershell
claude mcp add --transport http palmierwin http://127.0.0.1:19789/mcp
```

Ask the agent to read the current timeline. Available tools include `get_timeline`, `get_media`, `import_media`, `edit_timeline`, `undo`, `redo`, `export_project`, and `manage_exports`. Editing uses integer timeline frames. Batches are atomic and share the visible undo history. The service binds to loopback and rejects browser-origin requests.

PalmierWin does not include Palmier accounts or hosted generation services. Use your own generation tools and import their outputs.

## Preview and test

The editor also has a dependency-free local browser preview:

```sh
npm run preview
# Open http://127.0.0.1:4173
npm run check
npm test
```

The preview stores imported media in IndexedDB and edits in localStorage. Native desktop features are identified as such in the UI.

For UI smoke tests, start a separate Chromium with `--remote-debugging-port=9222`, run the preview, then run `node scripts/smoke.mjs`. The tests use the built-in DevTools protocol and have no Playwright dependency.

Source layout: `src/core` holds the shared project model and history; `src/desktop` holds Electron IPC, FFmpeg, provider connections and MCP; `src/renderer` holds the workspace UI. `scripts/generate-demo.py` reproduces the bundled procedural demo assets with Pillow and FFmpeg.

See [third-party notices](THIRD_PARTY_NOTICES.md). PalmierWin is not affiliated with Palmier, Inc.
