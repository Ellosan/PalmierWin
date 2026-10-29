# PalmierWin desktop design review

Reviewed and implemented on 2026-10-29 using Apple Design Review and React Bits Web Studio. The target is a Windows Electron video editor. Apple guidance is used for transferable usability principles; macOS-only styling and metrics are not treated as Windows requirements. React Bits' motion recipes are adapted with native CSS; no React migration or React Bits component source is included.

## Findings addressed

| Severity | What | Why | Fix and source | Supporting guidance |
| --- | --- | --- | --- | --- |
| High | Space on the project-menu button started playback. | Editor shortcuts intercepted ordinary control activation. | Give focused controls priority and respect handled key events. `src/renderer/app.mjs:1092` | [Keyboard access](https://developer.apple.com/design/human-interface-guidelines/accessibility) |
| Medium | Menus lacked arrow navigation and reliable Escape focus return. | Keyboard users could lose their place, especially after a clip rerendered. | Shared menu handling, letter navigation, Escape, Tab and restoration to the replacement clip node. `src/renderer/ui.mjs:102` | [Menus](https://developer.apple.com/design/human-interface-guidelines/menus) |
| Medium | Important metadata used 8px text and low contrast. | Media details and timeline state were difficult to scan. | Increase label sizes, strengthen muted colors and label backgrounds, and preserve visible focus. `src/renderer/styles.css:2891` | [Vision and control accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) |
| Medium | Settings mixed project format, provider credentials and update tasks. | Users had to scan unrelated fields and could confuse project saves with update preferences. | Project, AI Assistant and Updates sections, vertical keyboard navigation, section-specific footer copy and direct assistant/update entry points. `src/renderer/app.mjs:845` | [Intuitive interactions](https://developer.apple.com/design/human-interface-guidelines/accessibility) |
| Medium | Dialogs lacked explicit accessible names; error notices disappeared on a timer. | Assistive-technology users lacked context and could miss actionable errors. | Name dialogs, focus their initial input, restore the opener, and keep errors dismissible until acknowledged. `src/renderer/ui.mjs:23` and `:41` | [Cognitive accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) |
| Low | Surface and control feedback lacked a consistent visual treatment. | Actions and changes of context were harder to distinguish. | Quiet sage accents, a prominent Import action, consistent surfaces and brief menu/dialog transitions with reduced-motion support. `src/renderer/styles.css:3225` and `:3347` | [Motion](https://developer.apple.com/design/human-interface-guidelines/motion) |

The keyboard, naming and contrast findings concern access to functionality. Accent color, corner treatment and transition timing are design recommendations, not claims of Apple platform compliance.

## Verification

- 14 browser design/update-control checks, including Settings navigation, menu focus, reduced motion, progress and restart states. The available-update scenario uses a simulated updater; it does not install software.
- 11 existing browser editing workflows, with no uncaught browser exceptions.
- Editor and assistant layouts checked at 1080×720, 1440×900 and 1920×1080. The app remains a desktop editor; mobile layout is outside this pass.
- Measured secondary-label contrast: media metadata 6.85:1, status bar 6.53:1. These are selected checks, not a whole-app conformance claim.
- Source and rendered layouts were inspected. Physical Windows Narrator, high-DPI display behavior and 200% text enlargement were not validated.

Sources consulted: [upstream skill](https://github.com/dickwu/apple-design-skill/blob/main/SKILL.md), [reference routing](https://github.com/dickwu/apple-design-skill/blob/main/references/hig-lookup.md), and the upstream accessibility, menus and motion references. The React Bits design playbook, motion recipes and quality review informed the native CSS treatment.
