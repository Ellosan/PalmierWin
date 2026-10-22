import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { ProjectStore, newProject } from "../src/core/project.mjs";
import { renderProject } from "../src/desktop/export.mjs";
const require = createRequire(import.meta.url);
let ffmpeg = "ffmpeg",
  ffprobe = "ffprobe";
try {
  ffmpeg = require("ffmpeg-static");
  ffprobe = require("ffprobe-static").path;
} catch {}
const available = spawnSync(ffmpeg, ["-version"]).status === 0;
const run = (binary, args) => {
  const r = spawnSync(binary, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
const metadata = (file) =>
  JSON.parse(
    run(ffprobe, [
      "-v",
      "error",
      "-show_format",
      "-show_streams",
      "-of",
      "json",
      file,
    ]),
  );
const pixel = (file, time, x, y) => {
  const r = spawnSync(ffmpeg, [
    "-v",
    "error",
    "-ss",
    String(time),
    "-i",
    file,
    "-vf",
    `crop=2:2:${x}:${y},scale=1:1`,
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "pipe:1",
  ]);
  assert.equal(r.status, 0, r.stderr?.toString());
  return [...r.stdout];
};

test(
  "FFmpeg exports real composited frames, audio, text and transform keyframes",
  { skip: !available, timeout: 60000 },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "palmierwin-render-test-"));
    try {
      const red = path.join(dir, "red.mp4"),
        blue = path.join(dir, "blue.png"),
        output = path.join(dir, "export.mp4");
      run(ffmpeg, [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=320x180:r=24:d=2",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        red,
      ]);
      run(ffmpeg, [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=320x180",
        "-frames:v",
        "1",
        blue,
      ]);
      const store = new ProjectStore(newProject());
      store.dispatch("set_settings", { width: 320, height: 180, fps: 24 });
      store.dispatch("import_media", {
        media: [
          {
            id: "red",
            name: "Red",
            type: "video",
            path: red,
            duration: 48,
            hasAudio: true,
          },
          {
            id: "blue",
            name: "Blue",
            type: "image",
            path: blue,
            duration: 48,
            hasAudio: false,
          },
        ],
      });
      store.dispatch("add_clip", { mediaId: "red", start: 0, duration: 48 });
      const overlay = store.dispatch("add_clip", {
        mediaId: "blue",
        trackId: "v2",
        start: 24,
        duration: 24,
      });
      store.dispatch("update_clip", {
        id: overlay,
        changes: {
          props: { scale: 50, rotation: 4, opacity: 60, fadeIn: 3, fadeOut: 3 },
        },
      });
      store.dispatch("set_keyframe", {
        id: overlay,
        property: "x",
        frame: 0,
        value: -10,
      });
      store.dispatch("set_keyframe", {
        id: overlay,
        property: "x",
        frame: 24,
        value: 10,
      });
      store.dispatch("add_text", {
        text: "A title: 50% 'safe'\nsecond line",
        start: 0,
        duration: 20,
        fontSize: 16,
        trackId: "v2",
      });
      const progress = [];
      await renderProject(store.snapshot, {
        binary: ffmpeg,
        output,
        resolvePath: (m) => m.path,
        onProgress: (n) => progress.push(n),
      });
      const result = metadata(output);
      assert.equal(
        result.streams.find((s) => s.codec_type === "video").width,
        320,
      );
      assert.ok(result.streams.some((s) => s.codec_type === "audio"));
      assert.ok(Math.abs(+result.format.duration - 2) < 0.1);
      assert.equal(progress.at(-1), 100);
      assert.ok((await stat(output)).size > 1000);
      const early = pixel(output, 0.9, 5, 5),
        late = pixel(output, 1.5, 150, 70);
      assert.ok(
        early[0] > 180 && early[2] < 40,
        `Expected red background, got ${early}`,
      );
      assert.ok(late[2] > 70, `Expected blue composited overlay, got ${late}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  "animated opacity and scale export successfully and change the actual output",
  { skip: !available, timeout: 60000 },
  async () => {
    const dir = await mkdtemp(
      path.join(tmpdir(), "palmierwin-animation-test-"),
    );
    try {
      const image = path.join(dir, "white.png"),
        output = path.join(dir, "animation.mp4");
      run(ffmpeg, [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=white:s=160x90",
        "-frames:v",
        "1",
        image,
      ]);
      const store = new ProjectStore(newProject());
      store.dispatch("set_settings", { width: 160, height: 90, fps: 24 });
      store.dispatch("import_media", {
        media: [
          {
            id: "white",
            name: "White",
            path: image,
            type: "image",
            duration: 48,
            hasAudio: false,
          },
        ],
      });
      const id = store.dispatch("add_clip", {
        mediaId: "white",
        duration: 48,
        start: 0,
      });
      for (const [property, a, b] of [
        ["opacity", 0, 100],
        ["scale", 70, 100],
        ["rotation", 0, 5],
      ]) {
        store.dispatch("set_keyframe", { id, property, frame: 0, value: a });
        store.dispatch("set_keyframe", { id, property, frame: 47, value: b });
      }
      await renderProject(store.snapshot, {
        binary: ffmpeg,
        output,
        resolvePath: (m) => m.path,
      });
      const a = pixel(output, 0.1, 80, 40),
        b = pixel(output, 1.8, 80, 40);
      assert.ok(b[0] > a[0] + 100, `${a} should be darker than ${b}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
