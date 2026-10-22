# Implementation and parity

Reference: [Palmier Pro](https://www.palmier.io/) and its public documentation, inspected October 21, 2026. This is an independent Windows application, not a source port or a verified 1:1 copy of the proprietary macOS app.

| Area | PalmierWin implementation |
| --- | --- |
| Desktop | Electron, custom Windows title bar, NSIS installer and portable executable targets; x64 Windows 10/11 |
| Workspace | Graphite three-pane media/preview/inspector editor; optional full-height left agent dock; colored video, title, and audio tracks |
| Media | Native file import/drop, image/video/audio metadata, thumbnails, search/type filters, SRT subtitle import, source path references |
| Editing | Frame-based placement, drag trims, razor/split, duplicate, delete, ripple delete, track locking/visibility/mute, snapping, zoom, project formats, alternate/duplicate timelines |
| Text | Multiline titles and imported captions, size, fill, transforms and fades; system sans-serif font |
| Finishing | Position, scale, rotation, opacity, brightness, contrast, saturation, playback speed, volume, fades; linear transform/opacity/volume keyframes |
| Preview | Canvas composition with source seeking and synchronized HTML media audio; composition guides and PNG frame capture |
| Video export | Actual FFmpeg compositing and audio mixing; H.264 MP4, H.265 MP4 and ProRes HQ MOV; selected timeline resolution/fps; progress/cancellation |
| Agent access | Local Streamable HTTP MCP at `127.0.0.1:19789/mcp`; shared atomic editing transactions and undo history |
| In-app agent | User-configured OpenAI-compatible Chat Completions endpoint with tool calling; keys encrypted by Electron safeStorage on Windows; deterministic local quick-edit buttons |
| Persistence | `.palmierwin` JSON project files, atomic saves, crash-recovery autosave; preview uses localStorage plus IndexedDB for imported blobs |

## Differences that remain

- Palmier's hosted chat, generation credits, image/video/music/voice services, model catalogue, and subscriptions are not reproduced. The Generate panel explains how to import output from the user's tools. No fake generation or transcription is shown.
- No automatic transcription, semantic footage search, beat detection, silence removal, multicam synchronization, motion tracking/masks, chroma key, LUTs, HDR color management, speed ramps, optical flow, or audio denoise.
- No nested timelines, linked A/V clip pairs, transitions beyond fades, rich text templates, or NLE XML/FCPXML interchange. Each imported video currently carries its own audio rather than exposing a separate linked audio clip.
- Projects reference media paths. They are not portable packages and cannot read Palmier's proprietary project format. Keep source media in place; browser-preview projects referencing `browser:` media need their original browser IndexedDB or reimported sources.
- Preview and FFmpeg use separate text/color/rendering backends. Font metrics, extreme scale/rotation, color adjustments, media codec support, audio gain over 100%, and frame seek accuracy can differ. Export is the authoritative render. Audio gain above 100% is represented in exports; HTML media preview clamps gain at 100%.
- The browser preview is a UI/editor preview. Native dialogs, encrypted provider settings, MCP and video encoding are desktop features, explicitly identified in the UI.
- The installer is unsigned. Windows code signing and a real Windows hardware acceptance pass require the project owner's release environment. Linux tests do not establish Windows playback/codec behavior or pixel-perfect macOS parity.

## Validation

`npm test` covers actual exported video frames and audio streams, interpolation, source bounds, history, transactional rollback, subtitle parsing, media/track compatibility, and HTTP MCP interoperability and origin rejection. `scripts/smoke.mjs` drives the local Chromium preview through editing and persistence flows. The Windows CI workflow builds installers on `windows-latest` using Windows media binaries.

## Verified in this workspace

- 24 automated tests passed, including two FFmpeg render tests and HTTP MCP requests.
- 11 browser workflow checks passed at desktop and 1080 × 720 sizes, with no uncaught JavaScript exceptions.
- 6 real Electron desktop checks passed, including media probing, shared MCP/renderer history, alternate timelines, and a completed H.264 export.
- Windows x64 packaging is cross-compiled on Linux. A physical Windows run and provider-backed AI chat were not tested here.

Both Windows executables passed archive integrity checks. Their 15 runtime source files match the workspace. The same six desktop checks also passed while running the packaged ASAR archive on Linux (with Linux FFmpeg overrides), including export of unpacked bundled demo media. Windows executable launch itself remains untested.
