import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  net,
  shell,
  safeStorage,
} from "electron";
import {
  readFile,
  writeFile,
  mkdir,
  stat,
  access,
  rename,
} from "node:fs/promises";
import { constants, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadEnvFile } from "node:process";
import {
  ProjectStore,
  newProject,
  validateProject,
  uid,
  parseSrt,
} from "../core/project.mjs";
import { demoProject } from "../core/demo.mjs";
import { startMcp, createToolRunner, toolDefinitions } from "./mcp.mjs";
import { renderProject } from "./export.mjs";
import {
  NVIDIA_ENDPOINT,
  NVIDIA_MODEL,
  environmentKey,
  requestCompletion,
} from "./provider.mjs";

const require = createRequire(import.meta.url),
  execFileAsync = promisify(execFile);
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
// Development credentials stay outside the source and packaged application.
if (!app.isPackaged) {
  try {
    loadEnvFile(path.join(root, ".env.local"));
  } catch (error) {
    if (error.code !== "ENOENT")
      throw new Error("Could not load local provider settings.");
  }
}
app.setName("PalmierWin");
if (
  process.env.PALMIERWIN_USER_DATA &&
  path.isAbsolute(process.env.PALMIERWIN_USER_DATA)
)
  app.setPath("userData", process.env.PALMIERWIN_USER_DATA);
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => {
  if (window) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});
protocol.registerSchemesAsPrivileged([
  {
    scheme: "palmier-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
let window,
  store,
  filePath = null,
  saveTimer,
  mcpServer,
  exportController;
let exportJob = { status: "idle", progress: 0 },
  mcpStatus = "starting",
  settings = { endpoint: NVIDIA_ENDPOINT, model: NVIDIA_MODEL, key: null },
  conversation = [];
const mediaPaths = new Map();
const extensions = {
  image: [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"],
  video: [".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"],
  audio: [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"],
};
const userFile = (name) => path.join(app.getPath("userData"), name);
const atomicWrite = async (file, data) => {
  const tmp = `${file}.${uid()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
};
function binary(name) {
  const override = process.env[`PALMIERWIN_${name.toUpperCase()}_PATH`];
  if (override) {
    if (!path.isAbsolute(override))
      throw new Error(`${name} path must be absolute.`);
    return override;
  }
  try {
    let result =
      name === "ffmpeg"
        ? require("ffmpeg-static")
        : require("ffprobe-static").path;
    if (!result) throw new Error();
    return result.replace(
      "app.asar" + path.sep,
      "app.asar.unpacked" + path.sep,
    );
  } catch {
    throw new Error(
      `${name} is unavailable. Reinstall PalmierWin or set PALMIERWIN_${name.toUpperCase()}_PATH to the executable.`,
    );
  }
}
function resolveMedia(m) {
  if (m.path.startsWith("demo:")) {
    const name = m.path.slice(5);
    if (!["coast.mp4", "headland.png", "water.png", "tide.wav"].includes(name))
      throw new Error("Unknown demo asset.");
    // FFmpeg is a separate process and cannot read Electron's virtual ASAR paths.
    return path.join(root, "assets", "demo", name).replace(
      `${path.sep}app.asar${path.sep}`,
      `${path.sep}app.asar.unpacked${path.sep}`,
    );
  }
  if (!path.isAbsolute(m.path))
    throw new Error("Media must have an absolute local path.");
  return m.path;
}
function registerMedia() {
  mediaPaths.clear();
  for (const m of store.project.media) mediaPaths.set(m.id, resolveMedia(m));
}
function publish() {
  if (window && !window.isDestroyed())
    window.webContents.send("state", {
      project: store.snapshot,
      history: store.history,
      filePath,
      mcpStatus,
      revision: store.revision,
    });
}
function publishExport() {
  window?.webContents.send("export-progress", exportJob);
}
async function probe(file) {
  const type = Object.keys(extensions).find((k) =>
    extensions[k].includes(path.extname(file).toLowerCase()),
  );
  if (!type) throw new Error(`Unsupported media: ${path.basename(file)}`);
  const { stdout } = await execFileAsync(
    binary("ffprobe"),
    ["-v", "error", "-show_format", "-show_streams", "-of", "json", file],
    { maxBuffer: 4 * 1024 * 1024, windowsHide: true },
  );
  const metadata = JSON.parse(stdout),
    video = metadata.streams.find((s) => s.codec_type === "video");
  const seconds = Number(metadata.format?.duration ?? video?.duration ?? 5);
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new Error("Cannot determine this media duration.");
  return {
    id: uid(),
    path: file,
    name: path.basename(file),
    type,
    duration: Math.max(
      1,
      Math.round((type === "image" ? 30 : seconds) * store.project.fps),
    ),
    width: video?.width,
    height: video?.height,
    hasAudio: metadata.streams.some((s) => s.codec_type === "audio"),
  };
}
async function importMedia(paths) {
  const media = [],
    captions = [];
  for (const file of paths) {
    if (typeof file !== "string" || !path.isAbsolute(file))
      throw new Error("Import requires absolute local file paths.");
    if (!(await stat(file)).isFile()) throw new Error("Select a media file.");
    if (path.extname(file).toLowerCase() === ".srt")
      captions.push(
        ...parseSrt(await readFile(file, "utf8"), store.project.fps),
      );
    else media.push(await probe(file));
  }
  store.transaction(
    [
      ...(media.length ? [{ action: "import_media", args: { media } }] : []),
      ...captions,
    ],
    "Import media",
  );
  return { media, captions: captions.length };
}
async function saveProject(saveAs = false) {
  if (!filePath || saveAs) {
    const result = await dialog.showSaveDialog(window, {
      title: "Save project",
      defaultPath: `${store.project.name}.palmierwin`,
      filters: [{ name: "PalmierWin project", extensions: ["palmierwin"] }],
    });
    if (result.canceled) return null;
    filePath = result.filePath;
  }
  await atomicWrite(filePath, JSON.stringify(store.snapshot, null, 2));
  publish();
  return filePath;
}
async function loadProject(file) {
  const p = validateProject(JSON.parse(await readFile(file, "utf8")));
  // Project media paths are data; do not permit arbitrary schemes or relative traversal.
  for (const m of p.media) resolveMedia(m);
  filePath = file;
  store.replace(p);
  conversation = [];
  return store.snapshot;
}
async function startExport({
  output,
  codec = "h264",
  allowOverwrite = false,
} = {}) {
  if (exportJob.status === "rendering")
    throw new Error("An export is already running.");
  if (typeof output !== "string" || !path.isAbsolute(output))
    throw new Error("Choose an absolute output path.");
  if (!["h264", "h265", "prores"].includes(codec))
    throw new Error("Unsupported codec.");
  const ext = path.extname(output).toLowerCase();
  if (
    (codec === "prores" && ext !== ".mov") ||
    (codec !== "prores" && ext !== ".mp4")
  )
    throw new Error("Use .mov for ProRes or .mp4 for H.264/H.265.");
  if (!allowOverwrite) {
    try {
      await access(output);
      throw new Error("This output already exists. Choose a new filename.");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  const snapshot = store.snapshot,
    ffmpeg = binary("ffmpeg");
  if (!snapshot.clips.length) throw new Error("Add clips before exporting.");
  for (const m of snapshot.media.filter((m) =>
    snapshot.clips.some((c) => c.mediaId === m.id),
  ))
    await access(resolveMedia(m), constants.R_OK);
  const tempOutput = path.join(
    path.dirname(output),
    `.palmierwin-${uid()}${ext}`,
  );
  exportController = new AbortController();
  exportJob = { id: uid(), status: "rendering", progress: 0, output };
  publishExport();
  renderProject(snapshot, {
    binary: ffmpeg,
    output: tempOutput,
    codec,
    resolvePath: resolveMedia,
    signal: exportController.signal,
    onProgress: (progress) => {
      exportJob = { ...exportJob, progress };
      publishExport();
    },
  })
    .then(async () => {
      await rename(tempOutput, output);
      exportJob = { ...exportJob, status: "completed", progress: 100 };
      publishExport();
    })
    .catch(async (e) => {
      const { rm } = await import("node:fs/promises");
      await rm(tempOutput, { force: true });
      exportJob = {
        ...exportJob,
        status: exportController.signal.aborted ? "cancelled" : "failed",
        error: e.message,
      };
      publishExport();
    });
  return exportJob;
}
const publicSettings = () => ({
  endpoint: settings.endpoint,
  model: settings.model,
  hasKey: !!(settings.key || environmentKey(settings)),
});
async function persistSettings(value) {
  const url = new URL(value.endpoint);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw new Error("Use HTTPS for remote providers.");
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      "Use a base API URL without credentials, query or fragment.",
    );
  settings.endpoint = value.endpoint.replace(/\/$/, "");
  settings.model = String(value.model ?? "").slice(0, 200);
  if (value.clearKey) {
    settings.key = null;
    delete process.env.NVIDIA_API_KEY;
  }
  if (value.apiKey) {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error(
        "Windows credential encryption is unavailable. Your key was not saved.",
      );
    settings.key = safeStorage.encryptString(value.apiKey).toString("base64");
  }
  await atomicWrite(userFile("settings.json"), JSON.stringify(settings));
  conversation = [];
  return publicSettings();
}
let agentBusy = false;
async function agentChat(message) {
  if (agentBusy) throw new Error("Wait for the current agent request.");
  if (!settings.model || !(settings.key || environmentKey(settings)))
    throw new Error(
      "Connect an OpenAI-compatible provider in Settings, or connect Claude/Codex through MCP.",
    );
  if (typeof message !== "string" || !message.trim() || message.length > 20000)
    throw new Error("Enter a message under 20,000 characters.");
  const apiKey = settings.key
    ? safeStorage.decryptString(Buffer.from(settings.key, "base64"))
    : environmentKey(settings);
  agentBusy = true;
  const system = {
    role: "system",
    content:
      "You are the editing agent in PalmierWin, an independent Windows video editor. Read the timeline before editing. Use tools for all edits. Frame values are integers. Ask when intent is ambiguous. Never claim a cloud generation or transcription capability: this build does not have those services. Explain edits briefly. Do not access files or export without the user requesting it.",
  };
  const pending = [...conversation, { role: "user", content: message }];
  try {
    for (let step = 0; step < 8; step++) {
      const reply = await requestCompletion({
        endpoint: settings.endpoint,
        apiKey,
        model: settings.model,
        messages: [system, ...pending],
        tools: toolDefinitions.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        })),
      });
      pending.push(reply);
      if (!reply.tool_calls?.length) {
        conversation = pending.slice(-60);
        return reply.content || "Done.";
      }
      for (const call of reply.tool_calls) {
        let result;
        try {
          result = await runTool(
            call.function.name,
            JSON.parse(call.function.arguments),
          );
        } catch (e) {
          result = { error: e.message };
        }
        pending.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result ?? null),
        });
      }
    }
    conversation = pending;
    return "I reached the tool limit for this request. Review the timeline before continuing.";
  } finally {
    agentBusy = false;
  }
}
const runTool = (...args) => toolRunner(...args);
let toolRunner;
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error("Unauthorized window.");
    try {
      return { ok: true, value: await fn(...args) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}
function registerIpc() {
  handle("get-state", () => ({
    project: store.snapshot,
    history: store.history,
    filePath,
    mcpStatus,
  }));
  handle("edit", (action, args) => store.dispatch(action, args));
  handle("transaction", (commands) => store.transaction(commands));
  handle("undo", () => store.undo());
  handle("redo", () => store.redo());
  handle("new", () => {
    filePath = null;
    conversation = [];
    store.replace(newProject());
  });
  handle("demo", () => {
    filePath = null;
    conversation = [];
    store.replace(demoProject());
  });
  handle("save", (saveAs) => saveProject(saveAs));
  handle("open", async () => {
    const result = await dialog.showOpenDialog(window, {
      properties: ["openFile"],
      filters: [
        { name: "PalmierWin project", extensions: ["palmierwin", "json"] },
      ],
    });
    if (!result.canceled) return loadProject(result.filePaths[0]);
  });
  handle("import", async (paths) => {
    if (paths) return importMedia(paths);
    const result = await dialog.showOpenDialog(window, {
      title: "Import media",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Media and subtitles",
          extensions: [
            ...Object.values(extensions)
              .flat()
              .map((e) => e.slice(1)),
            "srt",
          ],
        },
      ],
    });
    if (!result.canceled) return importMedia(result.filePaths);
    return null;
  });
  handle("choose-export", async (codec) => {
    const ext = codec === "prores" ? "mov" : "mp4";
    const result = await dialog.showSaveDialog(window, {
      title: "Export video",
      defaultPath: `${store.project.name}.${ext}`,
      filters: [{ name: "Video", extensions: [ext] }],
    });
    if (result.canceled) return null;
    return startExport({
      output: result.filePath,
      codec,
      allowOverwrite: true,
    });
  });
  handle("cancel-export", () => {
    exportController?.abort();
  });
  handle("show-export", () => {
    if (exportJob.status === "completed")
      shell.showItemInFolder(exportJob.output);
  });
  handle("get-settings", publicSettings);
  handle("save-settings", persistSettings);
  handle("agent-chat", agentChat);
  handle("window", (action) => {
    if (action === "minimize") window.minimize();
    if (action === "maximize") {
      window.isMaximized() ? window.unmaximize() : window.maximize();
    }
    if (action === "close") window.close();
  });
}

// Do not top-level-await readiness in Electron's ESM entrypoint: it can block startup.
app
  .whenReady()
  .then(async () => {
    await mkdir(app.getPath("userData"), { recursive: true });
    let initial = demoProject();
    try {
      initial = validateProject(
        JSON.parse(await readFile(userFile("autosave.palmierwin"), "utf8")),
      );
    } catch {}
    try {
      settings = {
        ...settings,
        ...JSON.parse(await readFile(userFile("settings.json"), "utf8")),
      };
    } catch {}
    store = new ProjectStore(initial);
    registerMedia();
    store.subscribe(() => {
      registerMedia();
      publish();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(
        () =>
          atomicWrite(
            userFile("autosave.palmierwin"),
            JSON.stringify(store.snapshot),
          ).catch((e) => window?.webContents.send("notice", e.message)),
        500,
      );
    });
    protocol.handle("palmier-media", (request) => {
      const url = new URL(request.url),
        file = mediaPaths.get(decodeURIComponent(url.pathname.slice(1)));
      if (url.hostname !== "asset" || !file)
        return new Response("Unknown media", { status: 404 });
      return net.fetch(pathToFileURL(file).href, {
        headers: request.headers,
        bypassCustomProtocolHandlers: true,
      });
    });
    window = new BrowserWindow({
      width: 1600,
      height: 1000,
      minWidth: 1080,
      minHeight: 720,
      backgroundColor: "#202020",
      icon: path.join(root, "assets", "icon.png"),
      frame: false,
      show: false,
      webPreferences: {
        preload: path.join(root, "src", "desktop", "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      if (
        url !==
        pathToFileURL(path.join(root, "src", "renderer", "index.html")).href
      )
        event.preventDefault();
    });
    window.webContents.session.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    toolRunner = createToolRunner({
      store,
      importMedia,
      startExport,
      getExport: () => exportJob,
    });
    registerIpc();
    mcpServer = startMcp({
      runTool,
      onError: (e) => {
        mcpStatus = `unavailable: ${e.code ?? e.message}`;
        publish();
      },
    });
    mcpServer.on("listening", () => {
      mcpStatus = "connected";
      publish();
    });
    window.loadFile(path.join(root, "src", "renderer", "index.html"));
    window.once("ready-to-show", () => window.show());
    window.on("close", (event) => {
      if (exportJob.status === "rendering") {
        const response = dialog.showMessageBoxSync(window, {
          type: "question",
          buttons: ["Keep exporting", "Cancel export and close"],
          defaultId: 0,
          cancelId: 0,
          message: "A video export is still running.",
        });
        if (response === 0) {
          event.preventDefault();
          return;
        }
        exportController?.abort();
      }
    });
    app.on("window-all-closed", () => app.quit());
    app.on("before-quit", () => {
      mcpServer?.close();
      clearTimeout(saveTimer);
      if (store) {
        try {
          const file = userFile("autosave.palmierwin"),
            tmp = `${file}.closing.tmp`;
          writeFileSync(tmp, JSON.stringify(store.snapshot));
          renameSync(tmp, file);
        } catch {}
      }
    });
  })
  .catch((error) => {
    dialog.showErrorBox("PalmierWin could not start", error.message);
    app.quit();
  });
