export const VERSION = 1;
export const uid = () => globalThis.crypto.randomUUID();
export const clone = (value) => structuredClone(value);
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const endOf = (clip) => clip.start + clip.duration;
export const durationOf = (project) => Math.max(1, ...project.clips.map(endOf));
export const defaults = () => ({
  x: 0,
  y: 0,
  scale: 100,
  rotation: 0,
  opacity: 100,
  volume: 100,
  brightness: 100,
  contrast: 100,
  saturation: 100,
  fadeIn: 0,
  fadeOut: 0,
});

export function newProject(name = "Untitled project") {
  return {
    version: VERSION,
    id: uid(),
    name,
    width: 1920,
    height: 1080,
    fps: 30,
    media: [],
    tracks: [
      {
        id: "v2",
        name: "Titles",
        type: "video",
        muted: false,
        hidden: false,
        locked: false,
      },
      {
        id: "v1",
        name: "Video",
        type: "video",
        muted: false,
        hidden: false,
        locked: false,
      },
      {
        id: "a1",
        name: "Audio",
        type: "audio",
        muted: false,
        hidden: false,
        locked: false,
      },
    ],
    clips: [],
    markers: [],
    activeTimeline: { id: uid(), name: "Timeline 1" },
    timelines: [],
  };
}

function number(value, name, min, max, integer = false) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw new Error(
      `Invalid ${name}: expected ${integer ? "an integer" : "a number"} from ${min} to ${max}.`,
    );
}
function string(value, name, max = 2000) {
  if (typeof value !== "string" || value.length > max)
    throw new Error(`Invalid ${name}.`);
}
export function validateProject(p) {
  if (!p || p.version !== VERSION)
    throw new Error("This is not a supported PalmierWin project.");
  string(p.id, "project ID", 100);
  string(p.name, "project name", 200);
  number(p.width, "width", 16, 7680, true);
  number(p.height, "height", 16, 7680, true);
  number(p.fps, "frame rate", 1, 120, true);
  for (const key of ["tracks", "clips", "media", "markers"])
    if (!Array.isArray(p[key]) || p[key].length > 10000)
      throw new Error(`Invalid ${key}.`);
  const ids = new Set();
  for (const item of [...p.tracks, ...p.media, ...p.clips, ...p.markers]) {
    string(item.id, "ID", 100);
    if (ids.has(item.id)) throw new Error(`Duplicate ID: ${item.id}`);
    ids.add(item.id);
  }
  for (const track of p.tracks) {
    string(track.name, "track name", 200);
    if (!["video", "audio"].includes(track.type))
      throw new Error("Invalid track type.");
    for (const key of ["muted", "hidden", "locked"])
      if (typeof track[key] !== "boolean")
        throw new Error(`Invalid track ${key}.`);
  }
  for (const m of p.media) {
    string(m.name, "media name", 500);
    string(m.path, "media path", 8000);
    if (!["video", "audio", "image"].includes(m.type))
      throw new Error("Unsupported media type.");
    number(m.duration, "media duration", 1, 1e9, true);
  }
  for (const c of p.clips) {
    const track = p.tracks.find((t) => t.id === c.trackId);
    if (!track) throw new Error("Clip refers to a missing track.");
    if (
      c.type !== "text" &&
      !p.media.some((m) => m.id === c.mediaId && m.type === c.type)
    )
      throw new Error("Clip refers to missing media.");
    if (
      !["video", "audio", "image", "text"].includes(c.type) ||
      (c.type === "audio") !== (track.type === "audio")
    )
      throw new Error("Incompatible clip and track types.");
    number(c.start, "clip start", 0, 1e9, true);
    number(c.duration, "clip duration", 1, 1e9, true);
    number(c.in, "source in", 0, 1e9);
    number(c.speed, "speed", 0.1, 8);
    if (c.type === "video" || c.type === "audio") {
      const source = p.media.find((m) => m.id === c.mediaId);
      if (c.in + c.duration * c.speed > source.duration + 0.001)
        throw new Error("Clip extends beyond the source media.");
    }
    string(c.name, "clip name", 500);
    if (c.type === "text") {
      string(c.text, "text", 10000);
      number(c.fontSize, "font size", 8, 500);
      if (!/^#[0-9a-f]{6}$/i.test(c.color))
        throw new Error("Invalid text color.");
    }
    for (const [key, value] of Object.entries(defaults())) {
      const ranges = {
        x: [-200, 200],
        y: [-200, 200],
        scale: [1, 400],
        rotation: [-360, 360],
        opacity: [0, 100],
        volume: [0, 200],
        brightness: [0, 200],
        contrast: [0, 200],
        saturation: [0, 200],
        fadeIn: [0, c.duration],
        fadeOut: [0, c.duration],
      };
      number(c.props?.[key], key, ...ranges[key]);
    }
    if (!Array.isArray(c.keyframes) || c.keyframes.length > 1000)
      throw new Error("Invalid keyframes.");
    for (const k of c.keyframes) {
      if (
        !["x", "y", "scale", "rotation", "opacity", "volume"].includes(
          k.property,
        )
      )
        throw new Error("Unsupported keyframe property.");
      number(k.frame, "keyframe position", 0, c.duration, true);
      const ranges = {
        x: [-200, 200],
        y: [-200, 200],
        scale: [1, 400],
        rotation: [-360, 360],
        opacity: [0, 100],
        volume: [0, 200],
      };
      number(k.value, "keyframe value", ...ranges[k.property]);
    }
  }
  for (const m of p.markers) {
    number(m.frame, "marker frame", 0, 1e9, true);
    string(m.text, "marker text");
  }
  if (p.activeTimeline) {
    string(p.activeTimeline.id, "timeline ID", 100);
    string(p.activeTimeline.name, "timeline name", 200);
  }
  if (p.timelines) {
    if (!Array.isArray(p.timelines) || p.timelines.length > 100)
      throw new Error("Invalid timelines.");
    const timelineIds = new Set([p.activeTimeline?.id]);
    for (const timeline of p.timelines) {
      string(timeline.id, "timeline ID", 100);
      string(timeline.name, "timeline name", 200);
      if (timelineIds.has(timeline.id))
        throw new Error("Duplicate timeline ID.");
      timelineIds.add(timeline.id);
      validateProject({
        ...p,
        tracks: timeline.tracks,
        clips: timeline.clips,
        markers: timeline.markers,
        timelines: [],
      });
    }
  }
  return p;
}

export function propertyAt(clip, property, frame) {
  const keys = clip.keyframes
    .filter((k) => k.property === property)
    .sort((a, b) => a.frame - b.frame);
  if (!keys.length) return clip.props[property] ?? defaults()[property];
  const t = frame - clip.start;
  if (t <= keys[0].frame) return keys[0].value;
  for (let i = 1; i < keys.length; i++)
    if (t <= keys[i].frame) {
      const a = keys[i - 1],
        b = keys[i];
      return (
        a.value +
        ((b.value - a.value) * (t - a.frame)) / Math.max(1, b.frame - a.frame)
      );
    }
  return keys.at(-1).value;
}
export function opacityAt(c, frame) {
  const t = frame - c.start;
  return (
    (propertyAt(c, "opacity", frame) / 100) *
    Math.min(
      1,
      c.props.fadeIn ? t / c.props.fadeIn : 1,
      c.props.fadeOut ? (c.duration - t) / c.props.fadeOut : 1,
    )
  );
}

function clipById(p, id, edit = true) {
  const c = p.clips.find((c) => c.id === id);
  if (!c) throw new Error("Clip not found.");
  if (edit && p.tracks.find((t) => t.id === c.trackId)?.locked)
    throw new Error("Unlock this track before editing.");
  return c;
}
function trackById(p, id) {
  const t = p.tracks.find((t) => t.id === id);
  if (!t) throw new Error("Track not found.");
  if (t.locked) throw new Error("Unlock this track before editing.");
  return t;
}
export const actions = {
  rename(p, { name }) {
    p.name = name;
  },
  import_media(p, { media }) {
    p.media.push(...clone(media));
  },
  remove_media(p, { id }) {
    if (
      [p, ...(p.timelines ?? [])].some((t) =>
        t.clips.some((c) => c.mediaId === id),
      )
    )
      throw new Error("Remove this media from the timeline first.");
    p.media = p.media.filter((m) => m.id !== id);
  },
  add_clip(p, { mediaId, trackId, start, duration, sourceIn = 0 }) {
    const media = p.media.find((m) => m.id === mediaId);
    if (!media) throw new Error("Media not found.");
    const track = trackById(
      p,
      trackId ?? (media.type === "audio" ? "a1" : "v1"),
    );
    const length =
      duration ??
      (media.type === "image" ? p.fps * 5 : media.duration - sourceIn);
    const c = {
      id: uid(),
      mediaId,
      name: media.name,
      type: media.type,
      trackId: track.id,
      start:
        start ??
        Math.max(
          0,
          ...p.clips.filter((c) => c.trackId === track.id).map(endOf),
        ),
      duration: length,
      in: sourceIn,
      speed: 1,
      props: defaults(),
      keyframes: [],
    };
    p.clips.push(c);
    return c.id;
  },
  add_text(
    p,
    {
      text = "Your story starts here",
      start = 0,
      duration = p.fps * 5,
      trackId = "v2",
      fontSize = 84,
      color = "#ffffff",
    },
  ) {
    trackById(p, trackId);
    const c = {
      id: uid(),
      name: text.slice(0, 50),
      text,
      type: "text",
      trackId,
      start,
      duration,
      in: 0,
      speed: 1,
      fontSize,
      color,
      props: defaults(),
      keyframes: [],
    };
    p.clips.push(c);
    return c.id;
  },
  update_clip(p, { id, changes }) {
    const c = clipById(p, id);
    const allowed = [
      "name",
      "text",
      "fontSize",
      "color",
      "start",
      "duration",
      "in",
      "speed",
      "trackId",
    ];
    for (const k of allowed) if (Object.hasOwn(changes, k)) c[k] = changes[k];
    if (changes.trackId) trackById(p, changes.trackId);
    if (changes.props)
      for (const k of Object.keys(defaults()))
        if (Object.hasOwn(changes.props, k)) c.props[k] = changes.props[k];
    c.props.fadeIn = Math.min(c.duration, c.props.fadeIn);
    c.props.fadeOut = Math.min(c.duration, c.props.fadeOut);
    c.keyframes = c.keyframes.filter((k) => k.frame <= c.duration);
  },
  move_clip(p, { id, start, trackId }) {
    const c = clipById(p, id);
    c.start = start;
    if (trackId) {
      trackById(p, trackId);
      c.trackId = trackId;
    }
  },
  trim_clip(p, { id, edge, frame }) {
    const c = clipById(p, id);
    if (!["start", "end"].includes(edge)) throw new Error("Invalid trim edge.");
    const oldEnd = endOf(c),
      oldStart = c.start;
    if (edge === "start") {
      c.in += (frame - c.start) * c.speed;
      c.duration = oldEnd - frame;
      c.start = frame;
      c.keyframes = c.keyframes
        .map((k) => ({ ...k, frame: k.frame - (frame - oldStart) }))
        .filter((k) => k.frame >= 0 && k.frame <= c.duration);
    } else c.duration = frame - c.start;
    c.props.fadeIn = Math.min(c.duration, c.props.fadeIn);
    c.props.fadeOut = Math.min(c.duration, c.props.fadeOut);
    c.keyframes = c.keyframes.filter((k) => k.frame <= c.duration);
  },
  split_clip(p, { id, frame }) {
    const c = clipById(p, id);
    if (frame <= c.start || frame >= endOf(c))
      throw new Error(
        "Place the playhead inside the selected clip to split it.",
      );
    const offset = frame - c.start,
      tail = clone(c);
    const values = Object.fromEntries(
      ["x", "y", "scale", "rotation", "opacity", "volume"].map((k) => [
        k,
        propertyAt(c, k, frame),
      ]),
    );
    tail.id = uid();
    tail.start = frame;
    tail.duration -= offset;
    tail.in += offset * c.speed;
    tail.keyframes = c.keyframes
      .filter((k) => k.frame >= offset)
      .map((k) => ({ ...k, frame: k.frame - offset }));
    c.keyframes = c.keyframes.filter((k) => k.frame <= offset);
    for (const property of new Set(
      [...c.keyframes, ...tail.keyframes].map((k) => k.property),
    )) {
      c.keyframes = c.keyframes.filter(
        (k) => !(k.property === property && k.frame === offset),
      );
      tail.keyframes = tail.keyframes.filter(
        (k) => !(k.property === property && k.frame === 0),
      );
      c.keyframes.push({ property, frame: offset, value: values[property] });
      tail.keyframes.push({ property, frame: 0, value: values[property] });
    }
    c.duration = offset;
    c.props.fadeOut = 0;
    tail.props.fadeIn = 0;
    c.props.fadeIn = Math.min(c.props.fadeIn, c.duration);
    tail.props.fadeOut = Math.min(tail.props.fadeOut, tail.duration);
    p.clips.push(tail);
    return tail.id;
  },
  duplicate_clip(p, { id }) {
    const c = clone(clipById(p, id));
    c.id = uid();
    c.start = endOf(c);
    p.clips.push(c);
    return c.id;
  },
  delete_clip(p, { id, ripple = false }) {
    const c = clipById(p, id);
    if (
      ripple &&
      p.clips.some(
        (other) =>
          other.id !== id &&
          other.start >= endOf(c) &&
          p.tracks.find((t) => t.id === other.trackId)?.locked,
      )
    )
      throw new Error("Unlock affected tracks before ripple deleting.");
    p.clips = p.clips.filter((other) => other.id !== id);
    if (ripple) {
      for (const other of p.clips)
        if (other.start >= endOf(c)) other.start -= c.duration;
      for (const marker of p.markers)
        if (marker.frame >= endOf(c)) marker.frame -= c.duration;
    }
  },
  set_keyframe(p, { id, property, frame, value }) {
    const c = clipById(p, id);
    c.keyframes = c.keyframes.filter(
      (k) => !(k.property === property && k.frame === frame),
    );
    c.keyframes.push({ property, frame, value });
  },
  clear_keyframes(p, { id }) {
    clipById(p, id).keyframes = [];
  },
  add_marker(p, { frame, text = "New marker" }) {
    p.markers.push({ id: uid(), frame, text });
  },
  delete_marker(p, { id }) {
    p.markers = p.markers.filter((m) => m.id !== id);
  },
  add_track(p, { type = "video", name }) {
    const t = {
      id: uid(),
      type,
      name: name ?? (type === "audio" ? "Audio" : "Video"),
      muted: false,
      hidden: false,
      locked: false,
    };
    if (type === "video") p.tracks.unshift(t);
    else p.tracks.push(t);
    return t.id;
  },
  update_track(p, { id, changes }) {
    const t = p.tracks.find((t) => t.id === id);
    if (!t) throw new Error("Track not found.");
    for (const key of ["name", "muted", "hidden", "locked"])
      if (Object.hasOwn(changes, key)) t[key] = changes[key];
  },
  create_timeline(p, { name, duplicate = false }) {
    p.timelines ??= [];
    p.activeTimeline ??= { id: uid(), name: "Timeline 1" };
    const current = {
      ...p.activeTimeline,
      tracks: p.tracks,
      clips: p.clips,
      markers: p.markers,
    };
    const base = duplicate ? clone(current) : newProject();
    p.timelines.push(current);
    p.activeTimeline = {
      id: uid(),
      name: name ?? `Timeline ${p.timelines.length + 1}`,
    };
    p.tracks = base.tracks;
    p.clips = base.clips;
    p.markers = base.markers;
    return p.activeTimeline.id;
  },
  set_active_timeline(p, { id }) {
    if (id === p.activeTimeline?.id) return;
    const target = p.timelines?.find((t) => t.id === id);
    if (!target) throw new Error("Timeline not found.");
    p.timelines = p.timelines.filter((t) => t.id !== id);
    p.timelines.push({
      ...p.activeTimeline,
      tracks: p.tracks,
      clips: p.clips,
      markers: p.markers,
    });
    p.activeTimeline = { id: target.id, name: target.name };
    p.tracks = target.tracks;
    p.clips = target.clips;
    p.markers = target.markers;
  },
  rename_timeline(p, { name }) {
    p.activeTimeline ??= { id: uid(), name: "Timeline 1" };
    p.activeTimeline.name = name;
  },
  set_settings(p, { width = p.width, height = p.height, fps = p.fps }) {
    const ratio = fps / p.fps;
    for (const m of p.media)
      m.duration = Math.max(1, Math.round(m.duration * ratio));
    for (const c of [p, ...(p.timelines ?? [])].flatMap((t) => t.clips)) {
      for (const k of ["start", "duration"]) c[k] = Math.round(c[k] * ratio);
      c.in *= ratio;
      c.duration = Math.max(1, c.duration);
      c.props.fadeIn = Math.round(c.props.fadeIn * ratio);
      c.props.fadeOut = Math.round(c.props.fadeOut * ratio);
      for (const k of c.keyframes) k.frame = Math.round(k.frame * ratio);
    }
    for (const m of [p, ...(p.timelines ?? [])].flatMap((t) => t.markers))
      m.frame = Math.round(m.frame * ratio);
    p.width = width;
    p.height = height;
    p.fps = fps;
  },
};

export class ProjectStore {
  constructor(project = newProject()) {
    this.project = clone(validateProject(project));
    this.past = [];
    this.future = [];
    this.listeners = new Set();
    this.revision = 0;
  }
  get snapshot() {
    return clone(this.project);
  }
  get history() {
    return { canUndo: !!this.past.length, canRedo: !!this.future.length };
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(label) {
    this.revision++;
    for (const fn of this.listeners) fn(this.snapshot, this.history, label);
  }
  dispatch(action, args = {}) {
    return this.transaction([{ action, args }], action);
  }
  transaction(commands, label = "Edit") {
    const next = this.snapshot;
    const results = [];
    for (const { action, args } of commands) {
      if (!Object.hasOwn(actions, action))
        throw new Error(`Unknown edit: ${action}`);
      results.push(actions[action](next, args ?? {}));
    }
    validateProject(next);
    this.past.push(this.project);
    if (this.past.length > 100) this.past.shift();
    this.future = [];
    this.project = next;
    this.emit(label);
    return results.length === 1 ? results[0] : results;
  }
  replace(project) {
    this.project = clone(validateProject(project));
    this.past = [];
    this.future = [];
    this.emit("Open project");
  }
  undo() {
    if (!this.past.length) return false;
    this.future.push(this.project);
    this.project = this.past.pop();
    this.emit("Undo");
    return true;
  }
  redo() {
    if (!this.future.length) return false;
    this.past.push(this.project);
    this.project = this.future.pop();
    this.emit("Redo");
    return true;
  }
}

export function parseSrt(source, fps) {
  const time = (value) => {
    const m = value.trim().match(/^(\d{1,3}):(\d{2}):(\d{2})[,.](\d{3})$/);
    if (!m) throw new Error("Invalid subtitle timestamp.");
    return Math.round((+m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000) * fps);
  };
  return source
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const index = lines.findIndex((l) => l.includes("-->"));
      if (index < 0) throw new Error("Invalid SRT subtitle file.");
      const [a, b] = lines[index].split("-->");
      const start = time(a),
        end = time(b);
      if (end <= start) throw new Error("Subtitle end must follow its start.");
      return {
        action: "add_text",
        args: {
          text: lines
            .slice(index + 1)
            .join("\n")
            .replace(/<[^>]*>/g, ""),
          start,
          duration: end - start,
          fontSize: 54,
        },
      };
    });
}
