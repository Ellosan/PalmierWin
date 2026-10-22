import { propertyAt, opacityAt, endOf } from "../core/project.mjs";

export class Preview {
  constructor(canvas, bridge, onError) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.bridge = bridge;
    this.sources = new Map();
    this.project = null;
    this.frame = 0;
    this.playing = false;
    this.onError = onError;
    this.errors = new Set();
  }
  setProject(p) {
    this.project = p;
    if (this.canvas.width !== p.width || this.canvas.height !== p.height) {
      this.canvas.width = p.width;
      this.canvas.height = p.height;
    }
    for (const [id, entry] of this.sources)
      if (
        !p.media.some((m) => m.id === id) &&
        !(id.startsWith("clip:") && p.clips.some((c) => `clip:${c.id}` === id))
      ) {
        entry.disposed = true;
        entry.element.pause?.();
        entry.element.src = "";
        this.sources.delete(id);
      }
    for (const m of p.media) if (!this.sources.has(m.id)) this.load(m);
    this.draw(this.frame, false);
  }
  load(media) {
    const url = this.bridge.mediaUrl(media.id);
    const image = media.type === "image";
    const element = image
      ? new Image()
      : document.createElement(media.type === "audio" ? "audio" : "video");
    if (!image) {
      element.preload = "auto";
      element.playsInline = true;
    }
    const entry = { element, ready: false, error: false };
    this.sources.set(media.id, entry);
    const ready = () => {
      if (entry.disposed) return;
      entry.ready = true;
      this.draw(this.frame, this.playing);
    };
    element.addEventListener(image ? "load" : "loadeddata", ready);
    if (!image)
      element.addEventListener("seeked", () => {
        if (!this.playing) this.paint();
      });
    element.addEventListener("error", () => {
      if (entry.disposed) return;
      entry.error = true;
      if (!this.errors.has(media.id)) {
        this.errors.add(media.id);
        this.onError(
          `Media unavailable: ${media.name}. Reimport it if it has moved.`,
        );
      }
      this.paint();
    });
    if (url) element.src = url;
    else {
      entry.error = true;
      this.errors.add(media.id);
    }
  }
  draw(frame, playing = false) {
    if (!this.project) return;
    this.frame = frame;
    this.playing = playing;
    const p = this.project,
      active = new Map();
    // One element per timeline clip is needed when a source occurs more than once at once.
    for (const c of p.clips) {
      const track = p.tracks.find((t) => t.id === c.trackId);
      if (
        c.type === "text" ||
        track.hidden ||
        frame < c.start ||
        frame >= endOf(c)
      )
        continue;
      const source = this.sources.get(c.mediaId);
      if (!source || source.error) continue;
      let element = source.element;
      if (c.type !== "image") {
        const key = `clip:${c.id}`;
        if (!this.sources.has(key)) {
          element = document.createElement(
            c.type === "audio" ? "audio" : "video",
          );
          element.preload = "auto";
          element.playsInline = true;
          element.src = this.bridge.mediaUrl(c.mediaId);
          const entry = { element, ready: false };
          this.sources.set(key, entry);
          element.addEventListener("loadeddata", () => {
            entry.ready = true;
            this.draw(this.frame, this.playing);
          });
          element.addEventListener("seeked", () => {
            if (!this.playing) this.paint();
          });
          element.addEventListener("error", () => {
            entry.error = true;
          });
        } else element = this.sources.get(key).element;
        const time = (c.in + (frame - c.start) * c.speed) / p.fps;
        element.playbackRate = c.speed;
        element.muted = track.muted;
        const t = frame - c.start;
        const fade = Math.min(
          1,
          c.props.fadeIn ? t / c.props.fadeIn : 1,
          c.props.fadeOut ? (c.duration - t) / c.props.fadeOut : 1,
        );
        element.volume = Math.min(
          1,
          Math.max(0, (propertyAt(c, "volume", frame) / 100) * fade),
        );
        if (
          Number.isFinite(time) &&
          element.readyState >= 1 &&
          Math.abs(element.currentTime - time) > (playing ? 0.15 : 0.5 / p.fps)
        )
          element.currentTime = time;
        if (playing && element.paused) element.play().catch(() => {});
        if (!playing && !element.paused) element.pause();
        active.set(key, element);
      }
    }
    for (const [key, entry] of this.sources)
      if (!active.has(key) && !entry.element.paused) entry.element.pause?.();
    this.paint();
  }
  paint() {
    if (!this.project) return;
    const { ctx, project: p, frame } = this;
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, p.width, p.height);
    for (const track of [...p.tracks].reverse()) {
      if (track.hidden || track.type === "audio") continue;
      for (const c of p.clips
        .filter(
          (c) => c.trackId === track.id && frame >= c.start && frame < endOf(c),
        )
        .sort((a, b) => a.start - b.start)) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, opacityAt(c, frame)));
        ctx.translate(
          p.width / 2 + (p.width * propertyAt(c, "x", frame)) / 100,
          p.height / 2 + (p.height * propertyAt(c, "y", frame)) / 100,
        );
        ctx.rotate((propertyAt(c, "rotation", frame) * Math.PI) / 180);
        ctx.scale(
          propertyAt(c, "scale", frame) / 100,
          propertyAt(c, "scale", frame) / 100,
        );
        ctx.filter = `brightness(${c.props.brightness}%) contrast(${c.props.contrast}%) saturate(${c.props.saturation}%)`;
        if (c.type === "text") {
          ctx.fillStyle = c.color;
          ctx.font = `600 ${c.fontSize}px "Segoe UI", Arial, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const lines = c.text.split("\n"),
            lineHeight = c.fontSize * 1.15;
          lines.forEach((line, i) =>
            ctx.fillText(line, 0, (i - (lines.length - 1) / 2) * lineHeight),
          );
        } else {
          const source = this.sources.get(
            c.type === "image" ? c.mediaId : `clip:${c.id}`,
          );
          const e = source?.element;
          if (source?.ready && e) {
            const w = e.naturalWidth || e.videoWidth,
              h = e.naturalHeight || e.videoHeight;
            if (w && h) {
              const scale = Math.min(p.width / w, p.height / h);
              ctx.drawImage(
                e,
                (-w * scale) / 2,
                (-h * scale) / 2,
                w * scale,
                h * scale,
              );
            }
          } else if (source?.error || this.sources.get(c.mediaId)?.error) {
            ctx.fillStyle = "#aab79c";
            ctx.font = '28px "Segoe UI", sans-serif';
            ctx.textAlign = "center";
            ctx.fillText("Media offline", 0, 0);
          }
        }
        ctx.restore();
      }
    }
  }
  pause() {
    this.playing = false;
    for (const { element } of this.sources.values()) element.pause?.();
  }
  async capture() {
    this.draw(this.frame, false);
    const waits = [...this.sources.values()]
      .filter((e) => e.element.seeking)
      .map(
        (e) =>
          new Promise((resolve) => {
            e.element.addEventListener("seeked", resolve, { once: true });
            setTimeout(resolve, 2000);
          }),
      );
    await Promise.all(waits);
    this.paint();
    return new Promise((resolve) => this.canvas.toBlob(resolve, "image/png"));
  }
}
