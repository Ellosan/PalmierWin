const paths = {
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  x: "m6 6 12 12M6 18 18 6",
  square: "M5 5h14v14H5z",
  film: "M4 3h16v18H4zM4 8h16M4 16h16M8 3v18M16 3v18",
  chevronDown: "m8 10 4 4 4-4",
  chevronRight: "m10 8 4 4-4 4",
  folder: "M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z",
  folderOpen: "M3 18V5h6l3 3h9l-3 10zM3 11h18",
  save: "M5 3h12l4 4v14H3V3h2Zm2 0v7h10V3M7 21v-7h10v7",
  pencil: "m4 16 12-12 4 4L8 20H4zM14 6l4 4",
  settings:
    "m9 3-1 3-3 1-2 4 2 3v3l4 3 3-1 3 1 4-3v-3l2-3-2-4-3-1-1-3zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  sparkles:
    "m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6ZM20 2v4M18 4h4",
  undo: "M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12",
  redo: "m15 5 5 5-5 5M20 10h-9a6 6 0 0 0 0 12",
  plug: "m8 3 1 5m7-5-1 5M6 8h12v3a6 6 0 0 1-12 0zM12 17v5",
  upload: "M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6",
  import: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  search: "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-1 5 6 6",
  hardDrive: "m5 4-3 12v4h20v-4L19 4ZM2 15h20M16 18h2",
  grid: "M3 3h18v18H3ZM9 3v18M15 3v18M3 9h18M3 15h18",
  maximize: "M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5",
  camera: "M3 7h5l2-3h4l2 3h5v14H3zM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  skipBack: "M5 4v16m14-16L7 12l12 8z",
  skipForward: "M19 4v16M5 4l12 8-12 8z",
  stepBack: "M6 5v14m12-14-9 7 9 7z",
  stepForward: "M18 5v14M6 5l9 7-9 7z",
  play: "m8 4 12 8-12 8z",
  pause: "M8 5v14M16 5v14",
  sliders:
    "M5 3v4m0 4v10M12 3v10m0 4v4M19 3v2m0 4v12M3 7h4v4H3zM10 13h4v4h-4zM17 5h4v4h-4z",
  type: "M4 6V3h16v3M12 3v18M8 21h8",
  arrowUpRight: "M7 17 17 7M7 7h10v10",
  arrowUp: "M12 19V5m-5 5 5-5 5 5",
  smartphone: "M7 2h10v20H7zM11 18h2",
  layers: "m12 3 10 5-10 5L2 8Zm-9 9 9 5 9-5M3 17l9 5 9-5",
  cursor: "m5 3 14 10-7 1-3 7z",
  scissors:
    "M8 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm0 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM7 8l14 13M7 16 21 3",
  bookmark: "M6 3h12v18l-6-4-6 4z",
  magnet: "M4 3v10a8 8 0 0 0 16 0V3h-5v10a3 3 0 0 1-6 0V3ZM4 8h5M15 8h5",
  keyboard:
    "M2 5h20v14H2zM5 9h1m3 0h1m3 0h1m3 0h1M5 12h1m3 0h1m3 0h1m3 0h1M7 16h10",
  music:
    "M9 18V5l11-2v13M9 8l11-2M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3Zm11-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3",
  image: "M3 3h18v18H3zM3 17l6-6 5 5 3-3 4 4M16 7h.01",
  volume: "M11 4 6 8H2v8h4l5 4zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14",
  volumeOff: "M11 4 6 8H2v8h4l5 4zM16 9l6 6m-6 0 6-6",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  eyeOff:
    "m3 3 18 18M10 5c7-1 12 7 12 7a23 23 0 0 1-5 5M6 6a24 24 0 0 0-4 6s4 7 10 7c1 0 2 0 3-1",
  lock: "M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4",
  unlock: "M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  copy: "M8 8h13v13H8ZM16 8V3H3v13h5",
  check: "m5 12 4 4L19 6",
  link: "M9 15 15 9M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0",
  info: "M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  diamond: "m12 3 9 9-9 9-9-9z",
  refresh: "M20 8A9 9 0 1 0 21 15M20 2v6h-6",
  headphones: "M3 15v-3a9 9 0 0 1 18 0v3M3 13h4v8H3zM17 13h4v8h-4z",
};
export const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] ?? paths.square}"/></svg>`;
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]"))
    el.innerHTML = icon(el.dataset.icon);
}
