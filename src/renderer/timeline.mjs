import { durationOf, endOf, clamp } from "../core/project.mjs";
import { icon } from "./icons.mjs";
import {
  $,
  $$,
  esc,
  timecode,
  shortTime,
  toast,
  showContext,
  ask,
} from "./ui.mjs";

const HEADER = 143;
export class Timeline {
  constructor({
    getProject,
    getFrame,
    getSelected,
    select,
    seek,
    edit,
    thumbnail,
    onText,
    onMarker,
  }) {
    Object.assign(this, {
      getProject,
      getFrame,
      getSelected,
      select,
      seek,
      edit,
      thumbnail,
      onText,
      onMarker,
    });
    this.zoom = 1.5;
    this.snapping = true;
    this.tool = "select";
    this.drag = null;
    this.trackHeights = [];
    $("#ruler").addEventListener("pointerdown", (e) => this.seekDrag(e));
    $("#tracks").addEventListener("pointerdown", (e) => this.startDrag(e));
    $("#tracks").addEventListener("keydown", (e) => {
      if (["Enter", " "].includes(e.key)) {
        const clip = e.target.closest("[data-clip]");
        if (clip) {
          e.preventDefault();
          this.select(clip.dataset.clip);
          $(`[data-clip="${CSS.escape(clip.dataset.clip)}"]`)?.focus({
            preventScroll: true,
          });
        }
      }
    });
    $("#tracks").addEventListener("contextmenu", (e) => this.context(e));
    $("#ruler-markers").addEventListener("contextmenu", (e) =>
      this.markerContext(e),
    );
    $("#tracks").addEventListener("dragover", (e) => {
      e.preventDefault();
      const track = e.target.closest(".track");
      $$(".drop-target").forEach((t) => t.classList.remove("drop-target"));
      track?.classList.add("drop-target");
    });
    $("#tracks").addEventListener("dragleave", (e) =>
      e.target.closest(".track")?.classList.remove("drop-target"),
    );
    $("#tracks").addEventListener("drop", (e) => this.drop(e));
    $("#timeline-zoom").oninput = (e) => this.setZoom(+e.target.value);
    $("#zoom-in").onclick = () => this.setZoom(this.zoom * 1.3);
    $("#zoom-out").onclick = () => this.setZoom(this.zoom / 1.3);
    $("#zoom-fit").onclick = () => this.fit();
    $("#snapping").onclick = () => this.toggleSnap();
    for (const button of $$("[data-tool]"))
      button.onclick = () => this.setTool(button.dataset.tool);
    $("#timeline-scroll").addEventListener(
      "wheel",
      (e) => {
        if (e.ctrlKey) {
          e.preventDefault();
          this.setZoom(this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
        }
      },
      { passive: false },
    );
  }
  setTool(tool) {
    this.tool = tool;
    $$("[data-tool]").forEach((b) => {
      b.classList.toggle("active", b.dataset.tool === tool);
      b.setAttribute("aria-pressed", String(b.dataset.tool === tool));
    });
    $("#tracks").style.cursor = tool === "razor" ? "crosshair" : "";
  }
  toggleSnap() {
    this.snapping = !this.snapping;
    $("#snapping").classList.toggle("active", this.snapping);
    $("#snapping").setAttribute("aria-pressed", this.snapping);
  }
  setZoom(value) {
    this.zoom = clamp(value, 0.25, 6);
    $("#timeline-zoom").value = this.zoom;
    this.render();
  }
  fit() {
    this.setZoom(
      ($("#timeline-scroll").clientWidth - HEADER - 70) /
        durationOf(this.getProject()),
    );
    $("#timeline-scroll").scrollLeft = 0;
  }
  frameAt(clientX) {
    const r = $("#timeline-content").getBoundingClientRect();
    return Math.max(0, Math.round((clientX - r.left - HEADER) / this.zoom));
  }
  snap(value, exclude, delta = 0) {
    if (!this.snapping) return Math.max(0, value);
    const p = this.getProject(),
      points = [
        0,
        this.getFrame(),
        ...p.markers.map((m) => m.frame),
        ...p.clips
          .filter((c) => c.id !== exclude)
          .flatMap((c) => [c.start, endOf(c)]),
      ];
    let best = value,
      distance = 8 / this.zoom;
    for (const point of points)
      for (const v of [point, point - delta])
        if (Math.abs(v - value) < distance) {
          distance = Math.abs(v - value);
          best = v;
        }
    return Math.max(0, Math.round(best));
  }
  render() {
    const p = this.getProject(),
      duration = durationOf(p),
      width = Math.max(
        $("#timeline-scroll").clientWidth,
        HEADER + duration * this.zoom + 120,
      );
    $("#timeline-content").style.width = `${width}px`;
    const secondsPerTick =
      this.zoom * p.fps < 18 ? 5 : this.zoom * p.fps < 40 ? 2 : 1;
    const framesPerTick = secondsPerTick * p.fps;
    const ticks = [];
    for (
      let frame = 0;
      frame <= (width - HEADER) / this.zoom;
      frame += framesPerTick
    ) {
      ticks.push(
        `<div class="ruler-tick" style="left:${HEADER + frame * this.zoom}px"><span>${shortTime(frame, p.fps)}</span></div>`,
      );
      if (framesPerTick * this.zoom > 30)
        ticks.push(
          `<div class="ruler-tick ruler-minor" style="left:${HEADER + (frame + framesPerTick / 2) * this.zoom}px"></div>`,
        );
    }
    $("#ruler-ticks").innerHTML = ticks.join("");
    $("#ruler-markers").innerHTML = p.markers
      .map(
        (m) =>
          `<button class="marker" data-marker="${esc(m.id)}" style="left:${HEADER + m.frame * this.zoom}px" title="${esc(m.text)}" aria-label="Marker: ${esc(m.text)}"></button>`,
      )
      .join("");
    $("#ruler-markers")
      .querySelectorAll("[data-marker]")
      .forEach(
        (button) =>
          (button.onclick = (e) => {
            e.stopPropagation();
            const m = p.markers.find((m) => m.id === button.dataset.marker);
            this.seek(m.frame);
            toast(m.text);
          }),
      );
    $("#tracks").innerHTML = p.tracks
      .map(
        (t) =>
          `<div class="track ${t.type === "audio" ? "audio-track" : ""} ${t.hidden ? "track-hidden" : ""}" data-track="${esc(t.id)}"><div class="track-header">${icon(t.type === "audio" ? "music" : "film")}<span class="track-name" title="${esc(t.name)}">${esc(t.name)}</span><div class="track-controls"><button data-track-action="${t.type === "audio" ? "muted" : "hidden"}" class="${t.type === "audio" ? (t.muted ? "active" : "") : t.hidden ? "active" : ""}" title="${t.type === "audio" ? (t.muted ? "Unmute track" : "Mute track") : t.hidden ? "Show track" : "Hide track"}" aria-label="${t.type === "audio" ? "Toggle mute" : "Toggle visibility"}" aria-pressed="${t.type === "audio" ? t.muted : t.hidden}">${icon(t.type === "audio" ? (t.muted ? "volumeOff" : "volume") : t.hidden ? "eyeOff" : "eye")}</button><button data-track-action="locked" class="${t.locked ? "active" : ""}" title="${t.locked ? "Unlock" : "Lock"} track" aria-label="Toggle track lock" aria-pressed="${t.locked}">${icon(t.locked ? "lock" : "unlock")}</button></div></div>${p.clips
            .filter((c) => c.trackId === t.id)
            .map((c) => this.clipHtml(c))
            .join("")}</div>`,
      )
      .join("");
    $("#tracks")
      .querySelectorAll("[data-track-action]")
      .forEach(
        (b) =>
          (b.onclick = (e) => {
            e.stopPropagation();
            const t = p.tracks.find(
                (t) => t.id === b.closest(".track").dataset.track,
              ),
              key = b.dataset.trackAction;
            this.edit("update_track", {
              id: t.id,
              changes: { [key]: !t[key] },
            });
          }),
      );
    for (const c of p.clips)
      if (["video", "image"].includes(c.type)) {
        const fill = $("#tracks").querySelector(
          `[data-clip="${CSS.escape(c.id)}"] .clip-fill`,
        );
        const url = this.thumbnail(c.mediaId);
        if (fill && url)
          fill.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;
      }
    $("#timeline-clip-count").textContent =
      `${p.clips.length} clip${p.clips.length === 1 ? "" : "s"}`;
    $("#timeline-drop-hint").classList.toggle("hidden", !!p.clips.length);
    this.updatePlayhead();
  }
  clipHtml(c) {
    const p = this.getProject(),
      selected = this.getSelected() === c.id,
      width = Math.max(3, c.duration * this.zoom);
    const waves =
      c.type === "audio"
        ? `<div class="clip-waveform">${Array.from({ length: Math.min(1000, Math.ceil(width / 4)) }, (_, i) => `<i style="height:${3 + (Math.sin(i * 1.9) + Math.sin(i * 0.48) + 2) * 3}px"></i>`).join("")}</div>`
        : "";
    return `<div class="timeline-clip type-${c.type}${selected ? " selected" : ""}" data-clip="${esc(c.id)}" style="left:${HEADER + c.start * this.zoom}px;width:${width}px" tabindex="0" role="button" aria-pressed="${selected}" aria-label="${esc(c.name)}, starts ${timecode(c.start, p.fps)}, duration ${timecode(c.duration, p.fps)}" title="${esc(c.name)}"><div class="clip-fill"></div>${waves}<span class="clip-label">${icon(c.type === "text" ? "type" : c.type === "audio" ? "music" : c.type === "image" ? "image" : "film")}${esc(c.name)}</span><span class="clip-duration">${shortTime(c.duration, p.fps)}</span>${c.keyframes.map((k) => `<span class="clip-keyframe" style="left:${k.frame * this.zoom}px"></span>`).join("")}<div class="trim-handle start" data-edge="start"></div><div class="trim-handle end" data-edge="end"></div></div>`;
  }
  updatePlayhead() {
    const p = this.getProject(),
      frame = this.getFrame();
    $("#playhead").style.left = `${HEADER + frame * this.zoom}px`;
    $("#ruler-label").textContent = timecode(frame, p.fps);
  }
  seekDrag(event) {
    if (
      event.button !== 0 ||
      event.target.closest(".ruler-label") ||
      event.target.closest(".marker")
    )
      return;
    const seek = (e) =>
      this.seek(
        Math.min(durationOf(this.getProject()) - 1, this.frameAt(e.clientX)),
      );
    seek(event);
    const move = (e) => seek(e),
      up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  startDrag(event) {
    if (event.button !== 0 || event.target.closest(".track-header")) return;
    const el = event.target.closest("[data-clip]");
    if (!el) {
      this.select(null);
      this.seek(
        Math.min(
          durationOf(this.getProject()) - 1,
          this.frameAt(event.clientX),
        ),
      );
      return;
    }
    event.preventDefault();
    const id = el.dataset.clip,
      p = this.getProject(),
      clip = p.clips.find((c) => c.id === id),
      track = p.tracks.find((t) => t.id === clip.trackId);
    // Selection updates the inspector, but avoid replacing the drag target until pointer-up.
    this.select(id, false);
    $$(".timeline-clip").forEach((c) =>
      c.classList.toggle("selected", c.dataset.clip === id),
    );
    if (track.locked) {
      toast("Unlock this track before editing.", true);
      return;
    }
    if (this.tool === "razor") {
      this.edit("split_clip", { id, frame: this.frameAt(event.clientX) });
      return;
    }
    const edge = event.target.closest("[data-edge]")?.dataset.edge,
      startX = event.clientX;
    let nextStart = clip.start,
      nextDuration = clip.duration,
      targetTrack = clip.trackId,
      moved = false;
    const move = (e) => {
      const delta = Math.round((e.clientX - startX) / this.zoom);
      if (Math.abs(e.clientX - startX) > 3) moved = true;
      if (!moved) return;
      if (edge === "start") {
        const minimum =
          clip.type === "video" || clip.type === "audio"
            ? Math.max(0, Math.ceil(clip.start - clip.in / clip.speed))
            : 0;
        nextStart = clamp(
          this.snap(clip.start + delta, id),
          minimum,
          endOf(clip) - 1,
        );
        nextDuration = endOf(clip) - nextStart;
      } else if (edge === "end") {
        const m = p.media.find((m) => m.id === clip.mediaId),
          max =
            clip.type === "video" || clip.type === "audio"
              ? Math.floor((m.duration - clip.in) / clip.speed)
              : 1e9;
        nextDuration = clamp(
          this.snap(endOf(clip) + delta, id) - clip.start,
          1,
          max,
        );
      } else {
        nextStart = this.snap(clip.start + delta, id, clip.duration);
        const row = document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest(".track");
        const next = p.tracks.find((t) => t.id === row?.dataset.track);
        if (
          next &&
          !next.locked &&
          (clip.type === "audio") === (next.type === "audio")
        )
          targetTrack = next.id;
      }
      el.style.left = `${HEADER + nextStart * this.zoom}px`;
      el.style.width = `${nextDuration * this.zoom}px`;
      if (!edge) {
        const row = $("#tracks").querySelector(
          `[data-track="${CSS.escape(targetTrack)}"]`,
        );
        if (el.parentElement !== row) row.append(el);
      }
      $("#status-text").textContent =
        `${edge ? "Trim" : "Move"} · ${timecode(nextStart, p.fps)} → ${timecode(nextStart + nextDuration, p.fps)}`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) {
        if (edge)
          this.edit("trim_clip", {
            id,
            edge,
            frame: edge === "start" ? nextStart : clip.start + nextDuration,
          });
        else
          this.edit("move_clip", {
            id,
            start: nextStart,
            trackId: targetTrack,
          });
      } else this.render();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  }
  drop(event) {
    event.preventDefault();
    $$(".drop-target").forEach((t) => t.classList.remove("drop-target"));
    const mediaId = event.dataTransfer.getData("application/palmier-media");
    if (!mediaId) return;
    const row = event.target.closest(".track");
    if (!row) return;
    const p = this.getProject(),
      m = p.media.find((m) => m.id === mediaId),
      track = p.tracks.find((t) => t.id === row.dataset.track);
    if (!m) return;
    if ((m.type === "audio") !== (track.type === "audio")) {
      toast(
        "Drop audio onto an audio track, and visuals onto a video track.",
        true,
      );
      return;
    }
    this.edit("add_clip", {
      mediaId,
      trackId: track.id,
      start: this.snap(this.frameAt(event.clientX)),
    });
  }
  context(event) {
    const el = event.target.closest("[data-clip]");
    if (!el) return;
    const id = el.dataset.clip;
    this.select(id);
    showContext(event, [
      {
        label: "Split at playhead",
        icon: "scissors",
        run: () => this.edit("split_clip", { id, frame: this.getFrame() }),
      },
      {
        label: "Duplicate clip",
        icon: "copy",
        run: () => this.edit("duplicate_clip", { id }),
      },
      {
        label: "Add marker here",
        icon: "bookmark",
        run: () => this.onMarker(),
      },
      null,
      {
        label: "Delete",
        icon: "trash",
        danger: true,
        run: () => this.edit("delete_clip", { id }),
      },
      {
        label: "Ripple delete",
        danger: true,
        run: () => this.edit("delete_clip", { id, ripple: true }),
      },
    ]);
  }
  markerContext(event) {
    const button = event.target.closest("[data-marker]");
    if (!button) return;
    const id = button.dataset.marker;
    showContext(event, [
      {
        label: "Delete marker",
        icon: "trash",
        run: () => this.edit("delete_marker", { id }),
      },
    ]);
  }
}
