import test from "node:test";
import assert from "node:assert/strict";
import {
  ProjectStore,
  newProject,
  validateProject,
  defaults,
  propertyAt,
  opacityAt,
  parseSrt,
  durationOf,
} from "../src/core/project.mjs";
import { demoProject } from "../src/core/demo.mjs";

function fixture() {
  const store = new ProjectStore(newProject("Test"));
  store.dispatch("import_media", {
    media: [
      {
        id: "video",
        name: "Footage",
        type: "video",
        path: "/clip.mp4",
        duration: 900,
        hasAudio: true,
      },
      {
        id: "audio",
        name: "Sound",
        type: "audio",
        path: "/sound.wav",
        duration: 900,
        hasAudio: true,
      },
    ],
  });
  const id = store.dispatch("add_clip", {
    mediaId: "video",
    start: 30,
    duration: 300,
    sourceIn: 60,
  });
  return { store, id };
}
test("the sample project is valid and has an actual 20-second timeline", () => {
  const p = demoProject();
  validateProject(p);
  assert.equal(durationOf(p), 600);
  assert.equal(p.clips.length, 6);
});
test("splitting preserves source in, total timing and shared undo history", () => {
  const { store, id } = fixture(),
    before = store.snapshot,
    tail = store.dispatch("split_clip", { id, frame: 150 });
  assert.equal(store.project.clips.find((c) => c.id === id).duration, 120);
  assert.equal(store.project.clips.find((c) => c.id === tail).in, 180);
  assert.equal(store.project.clips.find((c) => c.id === tail).duration, 180);
  store.undo();
  assert.deepEqual(store.snapshot, before);
  store.redo();
  assert.equal(store.project.clips.length, 2);
});
test("invalid batches roll back every edit and do not create history", () => {
  const { store, id } = fixture(),
    before = store.snapshot,
    depth = store.past.length;
  assert.throws(() =>
    store.transaction([
      { action: "rename", args: { name: "Should roll back" } },
      { action: "update_clip", args: { id, changes: { duration: -10 } } },
    ]),
  );
  assert.deepEqual(store.snapshot, before);
  assert.equal(store.past.length, depth);
});
test("undo then edit invalidates the redo branch", () => {
  const { store, id } = fixture();
  store.dispatch("move_clip", { id, start: 100 });
  store.undo();
  store.dispatch("rename", { name: "New branch" });
  assert.equal(store.redo(), false);
});
test("ripple delete moves subsequent clips and markers together", () => {
  const { store, id } = fixture();
  const later = store.dispatch("add_clip", {
    mediaId: "video",
    start: 330,
    duration: 100,
  });
  store.dispatch("add_marker", { frame: 350, text: "Note" });
  store.dispatch("delete_clip", { id, ripple: true });
  assert.equal(store.project.clips.find((c) => c.id === later).start, 30);
  assert.equal(store.project.markers[0].frame, 50);
});
test("locked tracks reject manual and agent mutations", () => {
  const { store, id } = fixture();
  store.dispatch("update_track", { id: "v1", changes: { locked: true } });
  assert.throws(() => store.dispatch("move_clip", { id, start: 50 }), /Unlock/);
  assert.throws(
    () => store.dispatch("add_clip", { mediaId: "video", trackId: "v1" }),
    /Unlock/,
  );
  store.dispatch("update_track", { id: "v1", changes: { locked: false } });
  store.dispatch("move_clip", { id, start: 50 });
  assert.equal(store.project.clips[0].start, 50);
});
test("source boundaries, invalid speed and cross-type tracks are rejected", () => {
  const { store, id } = fixture();
  assert.throws(
    () => store.dispatch("update_clip", { id, changes: { duration: 1000 } }),
    /beyond/,
  );
  assert.throws(() =>
    store.dispatch("update_clip", { id, changes: { speed: 0 } }),
  );
  assert.throws(
    () => store.dispatch("move_clip", { id, start: 0, trackId: "a1" }),
    /Incompatible/,
  );
});
test("trim start advances the source without moving the far edge", () => {
  const { store, id } = fixture();
  store.dispatch("trim_clip", { id, edge: "start", frame: 90 });
  const c = store.project.clips[0];
  assert.equal(c.in, 120);
  assert.equal(c.start, 90);
  assert.equal(c.duration, 240);
});
test("speed edits preserve exact fractional source timing at an odd split frame", () => {
  const { store, id } = fixture();
  store.dispatch("update_clip", { id, changes: { speed: 1.5, duration: 200 } });
  const tail = store.dispatch("split_clip", { id, frame: 31 });
  assert.equal(store.project.clips.find((c) => c.id === tail).in, 61.5);
});
test("keyframes interpolate and split boundaries preserve animated values", () => {
  const { store, id } = fixture();
  store.dispatch("set_keyframe", {
    id,
    property: "scale",
    frame: 0,
    value: 100,
  });
  store.dispatch("set_keyframe", {
    id,
    property: "scale",
    frame: 300,
    value: 200,
  });
  assert.equal(propertyAt(store.project.clips[0], "scale", 180), 150);
  const tail = store.dispatch("split_clip", { id, frame: 180 });
  assert.equal(
    propertyAt(
      store.project.clips.find((c) => c.id === tail),
      "scale",
      180,
    ),
    150,
  );
  assert.equal(propertyAt(store.project.clips[0], "scale", 180), 150);
});
test("fades apply to the same opacity value as transform keyframes", () => {
  const { store, id } = fixture();
  store.dispatch("update_clip", {
    id,
    changes: { props: { opacity: 50, fadeIn: 60, fadeOut: 60 } },
  });
  const c = store.project.clips[0];
  assert.equal(opacityAt(c, 60), 0.25);
  assert.equal(opacityAt(c, 180), 0.5);
  assert.equal(opacityAt(c, 300), 0.25);
});
test("changing fps rescales edits and source metadata, preserving seconds", () => {
  const { store } = fixture();
  store.dispatch("set_settings", { fps: 60, width: 1080, height: 1920 });
  const c = store.project.clips[0];
  assert.equal(c.start, 60);
  assert.equal(c.duration, 600);
  assert.equal(c.in, 120);
  assert.equal(store.project.media[0].duration, 1800);
});
test("SRT captions parse multiline text, commas and CRLF without HTML", () => {
  const commands = parseSrt(
    "1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i>\r\nworld\r\n\r\n2\r\n00:00:03.000 --> 00:00:04.000\r\nAgain",
    30,
  );
  assert.equal(commands[0].args.start, 30);
  assert.equal(commands[0].args.duration, 45);
  assert.equal(commands[0].args.text, "Hello\nworld");
  assert.equal(commands.length, 2);
});
test("SRT import rejects backwards ranges", () => {
  assert.throws(() => parseSrt("1\n00:00:02,000 --> 00:00:01,000\nNo", 30));
});
test("project validation rejects duplicate IDs, missing properties and missing tracks", () => {
  const { store } = fixture();
  const p = store.snapshot;
  p.tracks[1].id = p.tracks[0].id;
  assert.throws(() => validateProject(p), /Duplicate/);
  const q = store.snapshot;
  delete q.clips[0].props.opacity;
  assert.throws(() => validateProject(q), /opacity/);
  const r = store.snapshot;
  r.clips[0].trackId = "missing";
  assert.throws(() => validateProject(r), /missing track/);
});
test("source assets cannot be deleted while in use", () => {
  const { store, id } = fixture();
  assert.throws(
    () => store.dispatch("remove_media", { id: "video" }),
    /timeline/,
  );
  store.dispatch("delete_clip", { id });
  store.dispatch("remove_media", { id: "video" });
  assert.equal(store.project.media.length, 1);
});
test("public snapshots cannot mutate canonical state", () => {
  const { store } = fixture();
  const p = store.snapshot;
  p.name = "Mutated";
  p.clips[0].props.opacity = 0;
  assert.equal(store.project.name, "Test");
  assert.equal(store.project.clips[0].props.opacity, 100);
});
test("alternate timelines preserve edits and rescale together when the frame rate changes", () => {
  const { store } = fixture(),
    original = store.project.activeTimeline.id;
  store.dispatch("create_timeline", { duplicate: true, name: "Alternate" });
  assert.equal(store.project.clips.length, 1);
  store.dispatch("set_settings", { fps: 60 });
  store.dispatch("set_active_timeline", { id: original });
  assert.equal(store.project.clips[0].duration, 600);
  assert.equal(store.project.timelines[0].name, "Alternate");
  assert.equal(store.project.timelines[0].clips[0].duration, 600);
});
test("an asset used only in an inactive timeline cannot be removed", () => {
  const { store } = fixture();
  store.dispatch("create_timeline", {});
  assert.equal(store.project.clips.length, 0);
  assert.throws(
    () => store.dispatch("remove_media", { id: "video" }),
    /timeline/,
  );
});
test("full-source speed edits can split without extending beyond the last source frame", () => {
  const { store, id } = fixture();
  store.dispatch("update_clip", { id, changes: { duration: 560, speed: 1.5 } });
  store.dispatch("split_clip", { id, frame: 31 });
  validateProject(store.snapshot);
  assert.equal(store.project.clips[1].in, 61.5);
});
