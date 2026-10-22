import { durationOf, endOf, clamp } from "../core/project.mjs";
import { getBridge, download } from "./bridge.mjs";
import { Preview } from "./preview.mjs";
import { Timeline } from "./timeline.mjs";
import { Inspector } from "./inspector.mjs";
import { icon, hydrateIcons } from "./icons.mjs";
import {
  $,
  $$,
  esc,
  timecode,
  shortTime,
  toast,
  modal,
  ask,
  confirmAction,
  showContext,
} from "./ui.mjs";

hydrateIcons();
const bridge = await getBridge();
if (!bridge.desktop) document.body.classList.add("browser-preview");
let state = await bridge.state(),
  project = state.project,
  selected = null,
  frame = project.clips.length ? 60 : 0;
let playing = false,
  playStart = 0,
  playStartFrame = 0,
  filter = "all",
  rightTab = "inspector",
  agentBusy = false,
  settings = await bridge.settings(),
  job = { status: "idle", progress: 0 };
const thumbs = new Map(),
  thumbPending = new Set();
let lastProjectId = project.id;
const preview = new Preview($("#preview"), bridge, (message) =>
  toast(message, true),
);
const getProject = () => project,
  getFrame = () => frame,
  getSelected = () => selected;
const timeline = new Timeline({
  getProject,
  getFrame,
  getSelected,
  select,
  seek,
  edit,
  thumbnail: (id) => thumbs.get(id),
  onText: addText,
  onMarker: addMarker,
});
const inspector = new Inspector({ getProject, getFrame, getSelected, edit });

async function edit(action, args) {
  pause();
  try {
    const result = await bridge.edit(action, args);
    if (
      ["add_clip", "add_text", "duplicate_clip", "split_clip"].includes(
        action,
      ) &&
      typeof result === "string"
    )
      select(result);
    return result;
  } catch (e) {
    toast(e.message, true);
    timeline.render();
    inspector.render();
    return null;
  }
}
async function transaction(commands) {
  pause();
  try {
    return await bridge.transaction(commands);
  } catch (e) {
    toast(e.message, true);
    return null;
  }
}
function select(id, render = true) {
  selected = id;
  if (id) showRight("inspector");
  inspector.render();
  if (render) timeline.render();
  $("#selected-status").textContent =
    project.clips.find((c) => c.id === id)?.name ?? "No clip selected";
}
function seek(value) {
  pause();
  frame = clamp(Math.round(value), 0, durationOf(project) - 1);
  updateTime();
  preview.draw(frame, false);
  if (
    rightTab === "inspector" &&
    !$("#inspector-panel").contains(document.activeElement)
  )
    inspector.render();
}
function updateTime() {
  $("#current-time").textContent = timecode(frame, project.fps);
  $("#total-time").textContent = timecode(durationOf(project), project.fps);
  timeline.updatePlayhead();
}
function pause() {
  playing = false;
  preview.pause();
  $("#play").innerHTML = icon("play");
  $("#play").setAttribute("aria-label", "Play");
}
function play() {
  if (!project.clips.length) return;
  if (playing) {
    pause();
    return;
  }
  if (frame >= durationOf(project) - 1) frame = 0;
  playing = true;
  playStart = performance.now();
  playStartFrame = frame;
  $("#play").innerHTML = icon("pause");
  $("#play").setAttribute("aria-label", "Pause");
  requestAnimationFrame(tick);
}
function tick(now) {
  if (!playing) return;
  const next =
    playStartFrame + Math.floor(((now - playStart) / 1000) * project.fps);
  if (next >= durationOf(project)) {
    frame = durationOf(project) - 1;
    pause();
    preview.draw(frame, false);
    updateTime();
    return;
  }
  if (next !== frame) {
    frame = next;
    preview.draw(frame, true);
    updateTime();
  }
  requestAnimationFrame(tick);
}
function showRight(tab) {
  $(".app-shell").classList.toggle("agent-mode", tab === "agent");
  $("#chat-toggle").classList.toggle("active", tab === "agent");
  rightTab = tab;
  for (const button of $$("[data-right]")) {
    const active = button.dataset.right === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active);
  }
  $("#agent-panel").classList.toggle("hidden", tab !== "agent");
  $("#inspector-panel").classList.toggle("hidden", tab !== "inspector");
  if (tab === "inspector") inspector.render();
}
function setLibrary(tab) {
  for (const b of $$("[data-library]")) {
    const active = b.dataset.library === tab;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", active);
  }
  $("#media-panel").classList.toggle("hidden", tab !== "media");
  $("#generate-panel").classList.toggle("hidden", tab !== "generate");
}
function renderState(next) {
  pause();
  state = next;
  project = next.project;
  if (project.id !== lastProjectId) {
    lastProjectId = project.id;
    selected = null;
    frame = 0;
    thumbs.clear();
    thumbPending.clear();
    $("#chat-messages").innerHTML = welcomeMarkup;
  }
  if (!project.clips.some((c) => c.id === selected)) selected = null;
  frame = clamp(frame, 0, durationOf(project) - 1);
  document.title = `${project.name} — PalmierWin`;
  $("#project-name").textContent = project.name;
  $("#undo").disabled = !next.history.canUndo;
  $("#redo").disabled = !next.history.canRedo;
  $(".titlebar-caption").textContent = project.name;
  const timelineName = project.activeTimeline?.name ?? "Timeline 1";
  $("#timeline-name").innerHTML = `${icon("film")}${esc(timelineName)}`;
  $("#active-timeline-label").textContent = timelineName;
  const allTimelines = [
    ...(project.timelines ?? []),
    project.activeTimeline ?? { id: "current", name: "Timeline 1" },
  ];
  $("#timeline-tabs").innerHTML =
    `<button class="timeline-more" id="timeline-more" title="Timeline options">···</button>${allTimelines.map((t) => `<button data-timeline="${esc(t.id)}" class="${t.id === project.activeTimeline?.id ? "active" : ""}">${esc(t.name)}</button>`).join("")}<button class="add-timeline" id="new-timeline" title="New timeline" aria-label="New timeline">${icon("plus")}</button>`;
  $("#format-badge").innerHTML =
    `${project.width} × ${project.height}<span>${project.fps} fps</span>`;
  $("#project-format").textContent = `${project.height}p / ${project.fps} fps`;
  $("#media-count").textContent = project.media.length;
  $("#empty-preview").classList.toggle("hidden", !!project.clips.length);
  $("#preview-tag").textContent =
    project.media.every((m) => m.path.startsWith("demo:")) &&
    project.media.length
      ? "SAMPLE PROJECT · ORIGINAL PROCEDURAL MEDIA"
      : "PREVIEW";
  $("#selected-status").textContent =
    project.clips.find((c) => c.id === selected)?.name ?? "No clip selected";
  $("#mcp-label").textContent = bridge.desktop
    ? next.mcpStatus === "connected"
      ? "MCP connected"
      : "MCP unavailable"
    : "MCP";
  $("#mcp-button .status-dot").style.background =
    bridge.desktop && next.mcpStatus === "connected" ? "#80a994" : "#888";
  $("#mcp-button").title = bridge.desktop
    ? "Connect an external agent"
    : "MCP is available in the Windows desktop app";
  $("#save-status").textContent = bridge.desktop
    ? "Autosaved locally"
    : "Saved in browser";
  preview.setProject(project);
  preview.draw(frame, false);
  renderMedia();
  timeline.render();
  inspector.render();
  updateTime();
}
const welcomeMarkup = $("#chat-messages").innerHTML;
bridge.onState(renderState);
bridge.onNotice((message) => toast(message, true));
bridge.onExport((value) => {
  job = value;
  renderExportProgress();
  if (value.status === "completed") toast("Your video is ready.");
  if (value.status === "failed") toast(value.error, true);
});

async function makeThumbnail(media) {
  if (
    thumbPending.has(media.id) ||
    thumbs.has(media.id) ||
    media.type === "audio"
  )
    return;
  thumbPending.add(media.id);
  if (media.path.startsWith("demo:")) {
    const file = media.path.endsWith("coast.mp4")
      ? "coast.png"
      : media.path.slice(5);
    thumbs.set(
      media.id,
      new URL(`../../assets/demo/${file}`, import.meta.url).href,
    );
    renderMedia(false);
    timeline.render();
    return;
  }
  const url = bridge.mediaUrl(media.id);
  if (!url) return;
  if (media.type === "image") {
    thumbs.set(media.id, url);
    renderMedia(false);
    timeline.render();
    return;
  }
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "metadata";
  video.src = url;
  const clear = () => {
    video.src = "";
    video.load();
  };
  const timer = setTimeout(clear, 7000);
  video.onloadeddata = () => {
    if (video.videoWidth) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 240;
        canvas.height = 135;
        canvas.getContext("2d").drawImage(video, 0, 0, 240, 135);
        thumbs.set(media.id, canvas.toDataURL("image/jpeg", 0.7));
        renderMedia(false);
        timeline.render();
      } catch {}
    }
    clearTimeout(timer);
    clear();
  };
}
function renderMedia(load = true) {
  const query = $("#media-search").value.trim().toLowerCase(),
    media = project.media.filter(
      (m) =>
        (filter === "all" || m.type === filter) &&
        m.name.toLowerCase().includes(query),
    );
  $("#media-grid").innerHTML =
    media
      .map((m) => {
        const wave = Array.from(
          { length: 26 },
          (_, i) =>
            `<i style="height:${4 + (Math.sin(i * 2.8) + Math.sin(i * 0.4) + 2) * 5}px"></i>`,
        ).join("");
        const thumbnail = thumbs.get(m.id);
        return `<div class="media-card" draggable="true" data-media="${esc(m.id)}" tabindex="0" role="button" aria-label="${esc(m.name)}. Double-click to add to timeline." title="Double-click to add to timeline"><div class="media-thumb ${m.type === "audio" ? "audio-thumb" : ""}">${thumbnail ? `<img src="${esc(thumbnail)}" alt="" draggable="false">` : m.type === "audio" ? `<div class="wave-preview">${wave}</div>` : icon(m.type === "image" ? "image" : "film")}<span class="duration">${m.type === "image" ? "STILL" : shortTime(m.duration, project.fps)}</span><span class="media-add" title="Add to timeline">${icon("plus")}</span></div><strong>${esc(m.name)}</strong><small>${icon(m.type === "audio" ? "music" : m.type === "image" ? "image" : "film")}${m.width ? `${m.width} × ${m.height}` : "Audio"}${m.path.startsWith("demo:") ? " · Sample" : ""}</small></div>`;
      })
      .join("") ||
    `<div class="media-empty">${project.media.length ? "No media matches your search." : "Your story starts with a file."}</div>`;
  if (load) for (const m of project.media) makeThumbnail(m);
}
async function importMedia(files) {
  pause();
  $("#status-text").textContent = "Importing media…";
  try {
    const result = files
      ? await bridge.importDropped(files)
      : await bridge.importMedia();
    if (result)
      toast(
        `Imported ${result.media.length} media item${result.media.length === 1 ? "" : "s"}${result.captions ? ` and ${result.captions} caption${result.captions === 1 ? "" : "s"}` : ""}.`,
      );
  } catch (e) {
    toast(e.message, true);
  } finally {
    $("#status-text").textContent = "Ready when you are";
  }
}
function addMedia(id, start = frame) {
  const media = project.media.find((m) => m.id === id);
  if (!media) return;
  const track =
    project.tracks.find(
      (t) =>
        t.type === (media.type === "audio" ? "audio" : "video") &&
        !t.locked &&
        t.id !== "v2",
    ) ??
    project.tracks.find(
      (t) =>
        t.type === (media.type === "audio" ? "audio" : "video") && !t.locked,
    );
  if (!track) {
    toast("Add or unlock a compatible track first.", true);
    return;
  }
  return edit("add_clip", { mediaId: id, start, trackId: track.id });
}
async function addText() {
  const text = await ask(
    "Add title",
    "What would you like it to say?",
    "Your story starts here",
  );
  if (text !== null) {
    const track = project.tracks.find((t) => t.type === "video" && !t.locked);
    if (!track) {
      toast("Unlock a video track first.", true);
      return;
    }
    await edit("add_text", { text, start: frame, trackId: track.id });
  }
}
async function addMarker() {
  const text = await ask(
    "Add marker",
    "Leave a note for this moment",
    "New marker",
  );
  if (text !== null) await edit("add_marker", { frame, text });
}
async function capture() {
  pause();
  try {
    const blob = await preview.capture();
    if (!blob) throw new Error("Could not capture this frame.");
    download(
      blob,
      `${project.name}-${timecode(frame, project.fps).replaceAll(":", "-")}.png`,
    );
    toast("Frame saved as PNG.");
  } catch (e) {
    toast(e.message, true);
  }
}

const commands = {
  new: async () => {
    if (
      project.clips.length &&
      !(await confirmAction(
        "Start a new project?",
        "Save a project file first if you want to keep this edit. The local autosave will become the new project.",
        "Create project",
      ))
    )
      return;
    pause();
    await bridge.newProject();
  },
  open: async () => {
    pause();
    await bridge.openProject();
  },
  save: async () => {
    const file = await bridge.saveProject();
    if (file) toast("Project saved.");
  },
  "save-as": async () => {
    const file = await bridge.saveProject(true);
    if (file) toast("Project saved.");
  },
  rename: async () => {
    const name = await ask("Rename project", "Project name", project.name);
    if (name?.trim()) await edit("rename", { name: name.trim() });
  },
  demo: async () => {
    if (
      project.clips.length &&
      !(await confirmAction(
        "Open the sample project?",
        "Save your current project file first to keep this edit.",
        "Open sample",
      ))
    )
      return;
    pause();
    await bridge.loadDemo();
  },
  import: () => importMedia(),
  settings: showSettings,
  mcp: showMcp,
};
async function command(name) {
  try {
    await commands[name]?.();
  } catch (e) {
    toast(e.message, true);
  }
}
document.addEventListener("click", (e) => {
  const button = e.target.closest("[data-command]");
  if (button) {
    $("#project-menu").classList.add("hidden");
    command(button.dataset.command);
  }
  const win = e.target.closest("[data-window]");
  if (win) bridge.window(win.dataset.window);
});
for (const button of $$("[data-right]"))
  button.onclick = () => showRight(button.dataset.right);
for (const button of $$("[data-library]"))
  button.onclick = () => setLibrary(button.dataset.library);
$("#project-menu-button").onclick = () => {
  const el = $("#project-menu");
  el.classList.toggle("hidden");
  $("#project-menu-button").setAttribute(
    "aria-expanded",
    !el.classList.contains("hidden"),
  );
};
document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest(".project-menu-wrap")) {
    $("#project-menu").classList.add("hidden");
    $("#project-menu-button").setAttribute("aria-expanded", "false");
  }
});
$("#undo").onclick = async () => {
  pause();
  await bridge.undo();
};
$("#redo").onclick = async () => {
  pause();
  await bridge.redo();
};
for (const id of ["import-button", "import-small", "generate-import"])
  $(`#${id}`).onclick = () => importMedia();
$("#media-search").oninput = () => renderMedia();
for (const button of $$("[data-filter]"))
  button.onclick = () => {
    filter = button.dataset.filter;
    $$("[data-filter]").forEach((b) =>
      b.classList.toggle("active", b === button),
    );
    renderMedia();
  };
$("#media-grid").addEventListener("dragstart", (e) => {
  const el = e.target.closest("[data-media]");
  if (el) {
    e.dataTransfer.setData("application/palmier-media", el.dataset.media);
    e.dataTransfer.effectAllowed = "copy";
  }
});
$("#media-grid").addEventListener("dblclick", (e) => {
  const el = e.target.closest("[data-media]");
  if (el) addMedia(el.dataset.media);
});
$("#media-grid").addEventListener("click", (e) => {
  const el = e.target.closest("[data-media]");
  if (el && e.target.closest(".media-add")) addMedia(el.dataset.media);
  else if (el)
    $("#status-text").textContent =
      "Double-click or drag this media onto the timeline";
});
$("#media-grid").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const el = e.target.closest("[data-media]");
    if (el) addMedia(el.dataset.media);
  }
});
$("#media-grid").addEventListener("contextmenu", (e) => {
  const el = e.target.closest("[data-media]");
  if (!el) return;
  const id = el.dataset.media;
  showContext(e, [
    { label: "Add at playhead", icon: "plus", run: () => addMedia(id) },
    {
      label: "Remove from media library",
      icon: "trash",
      danger: true,
      run: () => edit("remove_media", { id }),
    },
  ]);
});
$("#play").onclick = play;
$("#frame-back").onclick = () => seek(frame - 1);
$("#frame-forward").onclick = () => seek(frame + 1);
$("#skip-start").onclick = () => seek(0);
$("#skip-end").onclick = () => seek(durationOf(project) - 1);
$("#current-time").onclick = async () => {
  const value = await ask(
    "Go to timecode",
    "HH:MM:SS:FF",
    timecode(frame, project.fps),
  );
  if (value === null) return;
  const parts = value.split(":").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0) ||
    parts[1] > 59 ||
    parts[2] > 59 ||
    parts[3] >= project.fps
  ) {
    toast("Enter a valid HH:MM:SS:FF timecode.", true);
    return;
  }
  seek(((parts[0] * 60 + parts[1]) * 60 + parts[2]) * project.fps + parts[3]);
};
$("#guides-button").onclick = () => {
  $("#guides-overlay").classList.toggle("hidden");
  $("#guides-button").classList.toggle("active");
};
$("#capture-button").onclick = capture;
$("#viewer-fit").onclick = () =>
  toast("Preview is fitted to the available space.");
$("#timeline-name").onclick = (e) =>
  showContext(
    e,
    [
      ...(project.timelines ?? []),
      project.activeTimeline ?? { id: "current", name: "Timeline 1" },
    ].map((t) => ({
      label: t.name,
      icon: t.id === project.activeTimeline?.id ? "check" : "film",
      run: () => edit("set_active_timeline", { id: t.id }),
    })),
  );
$("#add-text").onclick = addText;
$("#add-marker").onclick = addMarker;
$("#add-track").onclick = (e) =>
  showContext(e, [
    {
      label: "Add video track",
      icon: "film",
      run: () => edit("add_track", { type: "video" }),
    },
    {
      label: "Add audio track",
      icon: "music",
      run: () => edit("add_track", { type: "audio" }),
    },
  ]);
$("#mcp-button").onclick = showMcp;
$("#settings-button").onclick = showSettings;
$("#agent-provider").onclick = showSettings;
$("#export-button").onclick = showExport;
$("#shortcuts-button").onclick = showShortcuts;
$("#chat-toggle").onclick = () =>
  showRight(rightTab === "agent" ? "inspector" : "agent");
$("#timeline-tabs").onclick = (e) => {
  const button = e.target.closest("[data-timeline]");
  if (button) edit("set_active_timeline", { id: button.dataset.timeline });
  if (e.target.closest("#new-timeline")) edit("create_timeline", {});
  if (e.target.closest("#timeline-more"))
    showContext(e, [
      {
        label: "Duplicate timeline",
        icon: "copy",
        run: () => edit("create_timeline", { duplicate: true }),
      },
      {
        label: "Rename timeline",
        icon: "pencil",
        run: async () => {
          const name = await ask(
            "Rename timeline",
            "Timeline name",
            project.activeTimeline?.name ?? "Timeline 1",
          );
          if (name?.trim())
            await edit("rename_timeline", { name: name.trim() });
        },
      },
    ]);
};

// Native file drop and internal timeline drag are separate event types.
let dragDepth = 0;
document.addEventListener("dragenter", (e) => {
  if ([...e.dataTransfer.types].includes("Files")) {
    e.preventDefault();
    dragDepth++;
    if (!$(".drop-overlay")) {
      const el = document.createElement("div");
      el.className = "drop-overlay";
      el.textContent = "Drop your media. Find your story.";
      document.body.append(el);
    }
  }
});
document.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) {
    $(".drop-overlay")?.remove();
    dragDepth = 0;
  }
});
document.addEventListener("dragover", (e) => {
  if ([...e.dataTransfer.types].includes("Files")) e.preventDefault();
});
document.addEventListener("drop", (e) => {
  dragDepth = 0;
  $(".drop-overlay")?.remove();
  if (e.dataTransfer.files.length) {
    e.preventDefault();
    importMedia([...e.dataTransfer.files]);
  }
});

$("#timeline-resize").addEventListener("pointerdown", (e) => {
  const start = e.clientY,
    height = $(".timeline").offsetHeight;
  const move = (e) => {
    $(".timeline").style.height =
      `${clamp(height + start - e.clientY, 180, innerHeight - 400)}px`;
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
});
$("#timeline-resize").onkeydown = (e) => {
  if (["ArrowUp", "ArrowDown"].includes(e.key)) {
    e.preventDefault();
    $(".timeline").style.height =
      `${clamp($(".timeline").offsetHeight + (e.key === "ArrowUp" ? 20 : -20), 180, innerHeight - 400)}px`;
  }
};
window.addEventListener("resize", () => timeline.render());
new ResizeObserver(() => {
  const canvas = $("#preview").getBoundingClientRect(),
    area = $("#canvas-area").getBoundingClientRect();
  Object.assign($("#guides-overlay").style, {
    inset: "auto",
    left: `${canvas.left - area.left}px`,
    top: `${canvas.top - area.top}px`,
    width: `${canvas.width}px`,
    height: `${canvas.height}px`,
  });
}).observe($("#preview"));

function addChat(text, role = "assistant", className = "") {
  if ($(".agent-welcome")) $("#chat-messages").innerHTML = "";
  const el = document.createElement("div");
  el.className = `chat-message ${role} ${className}`;
  el.textContent = text;
  $("#chat-messages").append(el);
  $("#chat-messages").scrollTop = $("#chat-messages").scrollHeight;
  return el;
}
async function quickEdit(kind) {
  showRight("agent");
  if (kind === "title") {
    const track = project.tracks.find((t) => t.type === "video" && !t.locked);
    if (!track) {
      toast("Unlock a video track first.", true);
      return;
    }
    await edit("add_text", {
      text: project.name,
      start: frame,
      trackId: track.id,
    });
    showRight("agent");
    addChat(
      "Quick edit · Added a title at the playhead. Select it to change the text, size, or placement.",
    );
  }
  if (kind === "vertical") {
    await edit("set_settings", { width: 1080, height: 1920 });
    showRight("agent");
    addChat(
      "Quick edit · Set the canvas to 1080 × 1920. Clips fit within the frame; use Scale and Position in the inspector to reframe them. Undo is available.",
    );
  }
  if (kind === "assemble") {
    const videoTrack = project.tracks.find(
        (t) => t.type === "video" && !t.locked && t.id !== "v2",
      ),
      audioTrack = project.tracks.find((t) => t.type === "audio" && !t.locked);
    const commands = [];
    let at = videoTrack
      ? Math.max(
          0,
          ...project.clips
            .filter((c) => c.trackId === videoTrack.id)
            .map(endOf),
        )
      : 0;
    for (const media of project.media) {
      if (media.type === "audio") {
        if (audioTrack)
          commands.push({
            action: "add_clip",
            args: { mediaId: media.id, trackId: audioTrack.id, start: 0 },
          });
      } else if (videoTrack) {
        const duration =
          media.type === "image" ? project.fps * 5 : media.duration;
        commands.push({
          action: "add_clip",
          args: {
            mediaId: media.id,
            trackId: videoTrack.id,
            start: at,
            duration,
          },
        });
        at += duration;
      }
    }
    if (!commands.length) {
      toast("Import media and unlock compatible tracks first.", true);
      return;
    }
    const result = await transaction(commands);
    if (result) {
      showRight("agent");
      timeline.fit();
      addChat(
        "Quick edit · Added your visual media in order and placed audio at the start. This assembly is one undoable edit.",
      );
    }
  }
}
$("#chat-messages").addEventListener("click", (e) => {
  const button = e.target.closest("[data-quick]");
  if (button) quickEdit(button.dataset.quick);
});
$("#chat-form").onsubmit = async (e) => {
  e.preventDefault();
  if (agentBusy) return;
  const input = $("#chat-input"),
    message = input.value.trim();
  if (!message) return;
  showRight("agent");
  addChat(message, "user");
  input.value = "";
  agentBusy = true;
  $("#chat-send").disabled = true;
  const pending = addChat("Thinking through the edit…", "assistant", "pending");
  try {
    const reply = await bridge.chat(message);
    pending.remove();
    addChat(reply);
  } catch (error) {
    pending.remove();
    addChat(error.message, "assistant", "error");
  } finally {
    agentBusy = false;
    $("#chat-send").disabled = false;
  }
};
$("#chat-input").onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("#chat-form").requestSubmit();
  }
};

async function showSettings() {
  pause();
  settings = await bridge.settings();
  modal(
    `${icon("settings")}Settings`,
    `<form id="settings-form"><h3 style="margin-top:0">Project format</h3><div class="form-row"><div class="form-field"><label for="setting-width">Width</label><input id="setting-width" type="number" min="16" max="7680" step="2" value="${project.width}" required></div><div class="form-field"><label for="setting-height">Height</label><input id="setting-height" type="number" min="16" max="7680" step="2" value="${project.height}" required></div></div><div class="form-row"><div class="form-field"><label for="setting-fps">Frame rate</label><select id="setting-fps">${[24, 25, 30, 50, 60, 120].map((v) => `<option value="${v}" ${project.fps === v ? "selected" : ""}>${v} fps</option>`).join("")}</select></div><div class="form-field"><label for="setting-preset">Aspect ratio</label><select id="setting-preset"><option value="custom">Current / custom</option value="1920,1080">16:9 · Landscape</option><option value="1080,1920">9:16 · Vertical</option><option value="1080,1080">1:1 · Square</option><option value="3840,2160">16:9 · 4K</option></select></div></div><h3>AI agent · your provider</h3><p class="browser-note">Connect an OpenAI-compatible Chat Completions provider with tool calling. Provider usage is billed to your account. Only your chat and tool context are sent when you send a message.</p><div class="form-field"><label for="setting-endpoint">API base URL</label><input id="setting-endpoint" type="url" value="${esc(settings.endpoint)}" ${!bridge.desktop ? "disabled" : ""}></div><div class="form-field"><label for="setting-model">Model ID</label><input id="setting-model" value="${esc(settings.model)}" placeholder="Enter a model ID from your provider" ${!bridge.desktop ? "disabled" : ""}></div><div class="form-field"><label for="setting-key">API key</label><input id="setting-key" type="password" autocomplete="off" placeholder="${settings.hasKey ? "A key is saved. Leave blank to keep it." : "Enter your provider API key"}" ${!bridge.desktop ? "disabled" : ""}><small>${bridge.desktop ? "Encrypted locally with Windows credential protection. Keys are never returned to the editor UI." : "Provider connections are available in the Windows desktop app."}</small></div>${settings.hasKey ? '<label class="browser-note"><input id="setting-clear-key" type="checkbox"> Remove saved API key</label>' : ""}<div class="info-box">Already use Claude, Codex, or Cursor? Connect them through the <button type="button" class="quiet-button" id="settings-mcp">local MCP server ${icon("arrowUpRight")}</button></div><div id="settings-error" class="inline-error" role="alert"></div></form>`,
    `<button class="quiet-button" data-close>Cancel</button><button class="primary-button" type="submit" form="settings-form">Save settings</button>`,
  );
  $("#setting-preset").onchange = (e) => {
    if (e.target.value === "custom") return;
    const [w, h] = e.target.value.split(",");
    $("#setting-width").value = w;
    $("#setting-height").value = h;
  };
  $("#settings-mcp").onclick = showMcp;
  $("#settings-form").onsubmit = async (e) => {
    e.preventDefault();
    const width = Number($("#setting-width").value),
      height = Number($("#setting-height").value),
      fps = Number($("#setting-fps").value);
    try {
      if (bridge.desktop)
        settings = await bridge.saveSettings({
          endpoint: $("#setting-endpoint").value,
          model: $("#setting-model").value,
          apiKey: $("#setting-key").value,
          clearKey: !!$("#setting-clear-key")?.checked,
        });
      if (
        width !== project.width ||
        height !== project.height ||
        fps !== project.fps
      ) {
        const ratio = fps / project.fps;
        await bridge.edit("set_settings", { width, height, fps });
        frame = Math.round(frame * ratio);
        updateTime();
      }
      $("#agent-provider").querySelector("span:not([data-icon])").textContent =
        settings.model || "Connect agent";
      $("#modal").close();
      toast("Settings saved.");
    } catch (error) {
      $("#settings-error").textContent = error.message;
    }
  };
}

function showMcp() {
  const url = "http://127.0.0.1:19789/mcp";
  modal(
    `${icon("plug")}Connect your agent`,
    `<p>Give Claude, Codex, or Cursor access to the open project. Agent edits appear on the timeline and share the same undo history.</p>${!bridge.desktop ? '<div class="info-box"><strong>Desktop app required.</strong> This is the browser preview. The MCP server starts when you open the Windows app.</div>' : state.mcpStatus !== "connected" ? `<div class="info-box">The local server is unavailable (${esc(state.mcpStatus)}). Check whether another app is using port 19789.</div>` : '<div class="info-box"><strong>Local server is running.</strong> Only local MCP clients can connect. Websites are blocked.</div>'}<h3>Codex</h3><div class="code-block" id="mcp-command">codex mcp add palmierwin --url ${url}</div><div class="copy-row"><button class="quiet-button" id="copy-mcp">${icon("copy")}Copy command</button></div><h3>Claude Code</h3><div class="code-block">claude mcp add --transport http palmierwin ${url}</div><h3>Other MCP clients</h3><p class="browser-note">Transport: Streamable HTTP<br>URL: <strong>${url}</strong><br>Ask your agent to read the active timeline to verify the connection.</p><div class="info-box">Tools can import media, edit clips, add titles, adjust color and audio, undo changes, and export videos. Use a trusted local agent.</div>`,
    `<button class="primary-button" data-close>Done</button>`,
  );
  $("#copy-mcp").onclick = async () => {
    try {
      await navigator.clipboard.writeText(
        `codex mcp add palmierwin --url ${url}`,
      );
      toast("Command copied.");
    } catch {
      toast("Select the command and copy it manually.", true);
    }
  };
}
function showExport() {
  pause();
  modal(
    `${icon("upload")}Export video`,
    `<div class="export-summary">${icon("film")}<div><strong>${esc(project.name)}</strong><span>${project.width} × ${project.height} · ${project.fps} fps · ${timecode(durationOf(project), project.fps)}</span></div></div><div id="export-options"><label class="form-field"><span>Codec</span><select id="export-codec"><option value="h264">H.264 · MP4 (recommended)</option><option value="h265">H.265 · MP4</option><option value="prores">Apple ProRes 422 HQ · MOV</option></select></label><p class="browser-note">Exports the composited timeline with titles, transforms, color adjustments, keyframes, fades, and mixed audio. Your original files stay intact.</p>${!bridge.desktop ? '<div class="info-box"><strong>Windows desktop app required for video export.</strong> The browser preview supports project files and frame capture. FFmpeg is bundled with the desktop build.</div>' : ""}</div><div id="export-progress-area" class="hidden"><div class="export-progress"><span id="export-progress-bar"></span></div><div class="export-progress-label"><span id="export-status-label">Rendering your story…</span><span id="export-percentage">0%</span></div><div id="export-error" class="export-error"></div></div>`,
    `<button class="quiet-button" id="export-cancel" data-close>Close</button><button class="secondary-button hidden" id="export-show">${icon("folderOpen")}Show in folder</button><button class="primary-button" id="export-start">${icon("upload")}Choose destination & export</button>`,
  );
  $("#export-start").onclick = async () => {
    try {
      const result = await bridge.exportVideo($("#export-codec").value);
      if (result) {
        job = result;
        renderExportProgress();
      }
    } catch (e) {
      toast(e.message, true);
    }
  };
  $("#export-show").onclick = () => bridge.showExport();
  $("#export-cancel").onclick = async () => {
    if (job.status === "rendering") {
      await bridge.cancelExport();
    } else $("#modal").close();
  };
  renderExportProgress();
}
function renderExportProgress() {
  if (!$("#export-progress-area")) return;
  const active = job.status !== "idle";
  $("#export-progress-area").classList.toggle("hidden", !active);
  $("#export-progress-bar").style.width = `${job.progress}%`;
  $("#export-percentage").textContent = `${job.progress}%`;
  $("#export-start").disabled =
    job.status === "rendering" || !project.clips.length;
  $("#export-start").classList.toggle("hidden", job.status === "rendering");
  $("#export-show").classList.toggle("hidden", job.status !== "completed");
  $("#export-cancel").textContent =
    job.status === "rendering" ? "Cancel export" : "Close";
  $("#export-status-label").textContent =
    {
      rendering: "Rendering your story…",
      completed: "Your video is ready.",
      failed: "Export failed.",
      cancelled: "Export cancelled.",
    }[job.status] ?? "";
  $("#export-error").textContent = job.error ?? "";
  if (job.status === "rendering")
    $("#status-text").textContent = `Exporting · ${job.progress}%`;
  else if (job.status === "completed")
    $("#status-text").textContent = "Export complete";
}
function showShortcuts() {
  const shortcuts = [
    ["Play / pause", "Space"],
    ["Step one frame", "← / →"],
    ["Go to start / end", "Home / End"],
    ["Selection / razor", "V / C"],
    ["Add title / marker", "T / M"],
    ["Split selected clip", "Ctrl K"],
    ["Trim start / end to playhead", "Q / W"],
    ["Delete / ripple delete", "Delete / Shift Delete"],
    ["Duplicate selected clip", "Ctrl D"],
    ["Undo / redo", "Ctrl Z / Ctrl Shift Z"],
    ["Import media", "Ctrl I"],
    ["Save / open project", "Ctrl S / Ctrl O"],
    ["Fit timeline", "Shift Z"],
    ["Toggle snapping", "S"],
  ];
  modal(
    `${icon("keyboard")}Keyboard shortcuts`,
    `<div class="shortcuts">${shortcuts.map(([label, key]) => `<span>${label}</span><kbd>${key}</kbd>`).join("")}</div>`,
    `<button class="primary-button" data-close>Done</button>`,
  );
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    $("#context-menu").classList.add("hidden");
    $("#project-menu").classList.add("hidden");
    return;
  }
  if (
    $("#modal").open ||
    e.target.closest("input,textarea,select,[contenteditable=true]")
  )
    return;
  const key = e.key.toLowerCase(),
    ctrl = e.ctrlKey || e.metaKey;
  const handled = () => e.preventDefault();
  if (ctrl) {
    if (["s", "o", "n", "i", "z", "y", "k", "d"].includes(key)) handled();
    if (key === "s") command(e.shiftKey ? "save-as" : "save");
    if (key === "o") command("open");
    if (key === "n") command("new");
    if (key === "i") importMedia();
    if (key === "z") {
      pause();
      e.shiftKey ? bridge.redo() : bridge.undo();
    }
    if (key === "y") {
      pause();
      bridge.redo();
    }
    if (key === "k" && selected) edit("split_clip", { id: selected, frame });
    if (key === "d" && selected) edit("duplicate_clip", { id: selected });
    return;
  }
  if (e.code === "Space") {
    handled();
    play();
  }
  if (e.key === "ArrowLeft") {
    handled();
    seek(frame - (e.shiftKey ? project.fps : 1));
  }
  if (e.key === "ArrowRight") {
    handled();
    seek(frame + (e.shiftKey ? project.fps : 1));
  }
  if (e.key === "Home") {
    handled();
    seek(0);
  }
  if (e.key === "End") {
    handled();
    seek(durationOf(project) - 1);
  }
  if (["Delete", "Backspace"].includes(e.key) && selected) {
    handled();
    edit("delete_clip", { id: selected, ripple: e.shiftKey });
  }
  if (key === "v") timeline.setTool("select");
  if (key === "c") timeline.setTool("razor");
  if (key === "t") addText();
  if (key === "m") addMarker();
  if (key === "s") timeline.toggleSnap();
  if (key === "z" && e.shiftKey) timeline.fit();
  if ((key === "q" || key === "w") && selected)
    edit("trim_clip", {
      id: selected,
      edge: key === "q" ? "start" : "end",
      frame,
    });
});
window.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  toast(event.reason?.message ?? "An unexpected operation failed.", true);
});
renderState(state);
showRight("inspector");
if (settings.model)
  $("#agent-provider").querySelector("span:not([data-icon])").textContent =
    settings.model;
setTimeout(() => timeline.fit(), 80);
window.__palmierwin = {
  get project() {
    return project;
  },
  get frame() {
    return frame;
  },
  get selected() {
    return selected;
  },
  seek,
  select,
  edit,
  transaction,
  pause,
  play,
};
