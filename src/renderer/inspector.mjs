import { propertyAt, clamp } from "../core/project.mjs";
import { icon } from "./icons.mjs";
import { $, esc, timecode } from "./ui.mjs";

export class Inspector {
  constructor({ getProject, getSelected, getFrame, edit }) {
    Object.assign(this, { getProject, getSelected, getFrame, edit });
    $("#inspector-panel").addEventListener("input", (e) => {
      if (e.target.type === "range") {
        const number = e.target
          .closest(".property-row")
          .querySelector("input[type=number]");
        if (number) number.value = e.target.value;
      }
    });
    $("#inspector-panel").addEventListener("change", (e) => this.change(e));
    $("#inspector-panel").addEventListener("click", (e) => this.click(e));
  }
  row(label, key, min, max, unit = "%", keyframe = false) {
    const c = this.clip,
      value = propertyAt(c, key, this.getFrame()) ?? c.props[key];
    return `<div class="property-row"><label for="prop-${key}">${label}</label><input type="range" min="${min}" max="${max}" step="1" value="${Math.round(value)}" data-property="${key}" aria-label="${label}"><input id="prop-${key}" type="number" min="${min}" max="${max}" step="1" value="${Math.round(value)}" data-property="${key}"><small>${unit}</small>${keyframe ? `<button data-key="${key}" class="${c.keyframes.some((k) => k.property === key) ? "keyed" : ""}" title="Add ${label.toLowerCase()} keyframe at the playhead" aria-label="Add ${label.toLowerCase()} keyframe">${icon("diamond")}</button>` : '<span style="width:10px"></span>'}</div>`;
  }
  render() {
    const p = this.getProject(),
      c = p.clips.find((c) => c.id === this.getSelected());
    this.clip = c;
    if (!c) {
      $("#inspector-panel").innerHTML =
        `<div class="project-inspector"><section class="project-section"><h3>⌄ &nbsp; Project</h3><div class="property-row"><label>Name</label><span title="${esc(p.name)}">${esc(p.name)}</span></div><div class="property-row"><label>Location</label><span>Local workspace</span></div><div class="property-row"><label>Duration</label><span>${timecode(Math.max(0, ...p.clips.map((c) => c.start + c.duration)), p.fps)}</span></div></section><section class="project-section"><h3>⌄ &nbsp; Settings</h3><div class="property-row"><label for="project-resolution">Resolution</label><select id="project-resolution" data-project="resolution"><option value="${p.width},${p.height}">${p.width} × ${p.height}</option><option value="1920,1080">1920 × 1080</option><option value="1080,1920">1080 × 1920</option><option value="3840,2160">3840 × 2160</option><option value="1080,1080">1080 × 1080</option></select></div><div class="property-row"><label for="project-fps">Frame rate</label><select id="project-fps" data-project="fps">${[24, 25, 30, 50, 60, 120].map((f) => `<option value="${f}" ${p.fps === f ? "selected" : ""}>${f} fps</option>`).join("")}</select></div><div class="property-row"><label>Aspect ratio</label><span>${p.width === p.height ? "1:1" : p.width > p.height ? "Landscape" : "Portrait"}</span></div></section><p class="browser-note">Select a clip on the timeline to edit its transform, color, sound, or timing.</p></div>`;
      return;
    }
    const section = (title, content, ico = "sliders") =>
      `<section class="inspector-section"><h3>${icon(ico)}${title}</h3>${content}</section>`;
    $("#inspector-panel").innerHTML =
      `<div class="inspector-header"><span>${c.type.toUpperCase()} CLIP</span><strong>${esc(c.name)}</strong></div>
      ${c.type === "text" ? section("Text", `<textarea data-field="text" aria-label="Title text">${esc(c.text)}</textarea><div class="property-row"><label for="font-size">Font size</label><input id="font-size" type="number" min="8" max="500" value="${c.fontSize}" data-field="fontSize"><small>px</small></div><div class="property-row"><label for="text-color">Fill</label><input id="text-color" type="color" value="${c.color}" data-field="color"></div>`, "type") : ""}
      ${c.type !== "audio" ? section("Transform", this.row("Scale", "scale", 1, 400, "%", true) + this.row("Position X", "x", -200, 200, "%", true) + this.row("Position Y", "y", -200, 200, "%", true) + this.row("Rotation", "rotation", -360, 360, "°", true) + this.row("Opacity", "opacity", 0, 100, "%", true)) : ""}
      ${["image", "video"].includes(c.type) ? section("Color", this.row("Brightness", "brightness", 0, 200) + this.row("Contrast", "contrast", 0, 200) + this.row("Saturation", "saturation", 0, 200), "sliders") : ""}
      ${["audio", "video"].includes(c.type) ? section("Audio", this.row("Volume", "volume", 0, 200, "%", true), "volume") : ""}
      ${section("Timing", `<div class="property-row"><label for="clip-start">Start frame</label><input id="clip-start" type="number" min="0" max="1000000000" value="${c.start}" data-field="start"></div><div class="property-row"><label for="clip-duration">Duration</label><input id="clip-duration" type="number" min="1" max="1000000000" value="${c.duration}" data-field="duration"><small>fr</small></div>${["video", "audio"].includes(c.type) ? `<div class="property-row"><label for="clip-speed">Playback speed</label><input id="clip-speed" type="number" min="0.1" max="8" step="0.1" value="${c.speed}" data-field="speed"><small>×</small></div>` : ""}<div class="property-row"><label for="fade-in">Fade in</label><input id="fade-in" type="number" min="0" max="${c.duration}" value="${c.props.fadeIn}" data-property="fadeIn"><small>fr</small></div><div class="property-row"><label for="fade-out">Fade out</label><input id="fade-out" type="number" min="0" max="${c.duration}" value="${c.props.fadeOut}" data-property="fadeOut"><small>fr</small></div>`, "film")}
      <div class="inspector-actions"><button class="secondary-button" data-inspect="duplicate">${icon("copy")}Duplicate</button><button class="secondary-button text-danger" data-inspect="delete">${icon("trash")}Delete</button>${c.keyframes.length ? '<button class="quiet-button" data-inspect="clear-keys">Clear keyframes</button>' : ""}</div>`;
  }
  async change(event) {
    if (event.target.dataset.project === "resolution") {
      const [width, height] = event.target.value.split(",").map(Number);
      await this.edit("set_settings", { width, height });
      return;
    }
    if (event.target.dataset.project === "fps") {
      await this.edit("set_settings", { fps: Number(event.target.value) });
      return;
    }
    const c = this.clip;
    if (!c) return;
    const target = event.target,
      field = target.dataset.field,
      property = target.dataset.property;
    if (property) {
      const value = Number(target.value);
      if (c.keyframes.some((k) => k.property === property))
        await this.edit("set_keyframe", {
          id: c.id,
          property,
          frame: clamp(this.getFrame() - c.start, 0, c.duration),
          value,
        });
      else
        await this.edit("update_clip", {
          id: c.id,
          changes: { props: { [property]: value } },
        });
    } else if (field) {
      let value = ["text", "color"].includes(field)
        ? target.value
        : Number(target.value);
      const changes = { [field]: value };
      if (field === "text") changes.name = value.slice(0, 50);
      if (field === "speed")
        changes.duration = Math.max(
          1,
          Math.floor((c.duration * c.speed) / value),
        );
      await this.edit("update_clip", { id: c.id, changes });
    }
  }
  click(event) {
    const c = this.clip;
    if (!c) return;
    const key = event.target.closest("[data-key]")?.dataset.key;
    if (key) {
      this.edit("set_keyframe", {
        id: c.id,
        property: key,
        frame: clamp(this.getFrame() - c.start, 0, c.duration),
        value: propertyAt(c, key, this.getFrame()),
      });
      return;
    }
    const action = event.target.closest("[data-inspect]")?.dataset.inspect;
    if (action === "delete") this.edit("delete_clip", { id: c.id });
    if (action === "duplicate") this.edit("duplicate_clip", { id: c.id });
    if (action === "clear-keys") this.edit("clear_keyframes", { id: c.id });
  }
}
