import { newProject, ProjectStore } from "./project.mjs";

export function demoProject() {
  const store = new ProjectStore(newProject("Somewhere, slowly"));
  store.dispatch("import_media", {
    media: [
      {
        id: "demo-coast",
        name: "01 — Pacific light.mp4",
        type: "video",
        path: "demo:coast.mp4",
        duration: 360,
        width: 1600,
        height: 900,
        hasAudio: false,
      },
      {
        id: "demo-headland",
        name: "02 — The headland.png",
        type: "image",
        path: "demo:headland.png",
        duration: 900,
        width: 1600,
        height: 900,
        hasAudio: false,
      },
      {
        id: "demo-water",
        name: "03 — Ocean study.png",
        type: "image",
        path: "demo:water.png",
        duration: 900,
        width: 1600,
        height: 900,
        hasAudio: false,
      },
      {
        id: "demo-sound",
        name: "04 — Soft tide.wav",
        type: "audio",
        path: "demo:tide.wav",
        duration: 600,
        hasAudio: true,
      },
    ],
  });
  store.dispatch("add_clip", {
    mediaId: "demo-coast",
    start: 0,
    duration: 240,
  });
  store.dispatch("add_clip", {
    mediaId: "demo-headland",
    start: 240,
    duration: 180,
  });
  store.dispatch("add_clip", {
    mediaId: "demo-water",
    start: 420,
    duration: 180,
  });
  const audio = store.dispatch("add_clip", {
    mediaId: "demo-sound",
    start: 0,
    duration: 600,
  });
  store.dispatch("update_clip", {
    id: audio,
    changes: { props: { volume: 40, fadeIn: 60, fadeOut: 90 } },
  });
  const title = store.dispatch("add_text", {
    text: "Somewhere,\nslowly.",
    start: 15,
    duration: 180,
    fontSize: 114,
    color: "#f9f4e8",
  });
  store.dispatch("update_clip", {
    id: title,
    changes: { props: { fadeIn: 20, fadeOut: 25 } },
  });
  const end = store.dispatch("add_text", {
    text: "A LITTLE FURTHER FROM THE EVERYDAY",
    start: 450,
    duration: 120,
    fontSize: 32,
    color: "#f9f4e8",
  });
  store.dispatch("update_clip", {
    id: end,
    changes: { props: { fadeIn: 20, fadeOut: 25 } },
  });
  store.dispatch("add_marker", {
    frame: 240,
    text: "Let the landscape breathe",
  });
  return store.snapshot;
}
