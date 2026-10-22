import {
  ProjectStore,
  uid,
  validateProject,
  newProject,
  parseSrt,
} from "../core/project.mjs";
import { demoProject } from "../core/demo.mjs";

export const download = (data, name, type = "application/octet-stream") => {
  const url = URL.createObjectURL(
    data instanceof Blob ? data : new Blob([data], { type }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
};
function chooseFiles(accept, multiple = true) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener("change", () => resolve([...input.files]), {
      once: true,
    });
    input.addEventListener("cancel", () => resolve([]), { once: true });
    input.click();
  });
}
function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("palmierwin-media", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function dbFile(mode, id, value) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("files", mode),
        store = tx.objectStore("files");
      let result;
      const request =
        mode === "readonly" ? store.get(id) : store.put(value, id);
      request.onsuccess = () => {
        result = request.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
async function inspectFile(file, url, fps) {
  const ext = file.name.split(".").at(-1).toLowerCase();
  const type =
    file.type.startsWith("image/") ||
    ["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(ext)
      ? "image"
      : file.type.startsWith("audio/") ||
          ["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(ext)
        ? "audio"
        : file.type.startsWith("video/") ||
            ["mp4", "mov", "mkv", "webm", "m4v", "avi"].includes(ext)
          ? "video"
          : null;
  if (!type) throw new Error(`Unsupported media: ${file.name}`);
  if (type === "image") {
    const image = await createImageBitmap(file);
    const result = {
      type,
      duration: fps * 30,
      width: image.width,
      height: image.height,
      hasAudio: false,
    };
    image.close();
    return result;
  }
  return new Promise((resolve, reject) => {
    const element = document.createElement(
      type === "audio" ? "audio" : "video",
    );
    element.preload = "metadata";
    const timer = setTimeout(() => {
      element.src = "";
      reject(
        new Error(
          `Could not read ${file.name}. Try this file in the desktop app.`,
        ),
      );
    }, 10000);
    element.onloadedmetadata = () => {
      clearTimeout(timer);
      const duration = element.duration;
      if (!Number.isFinite(duration)) {
        reject(new Error("This media has no finite duration."));
        return;
      }
      resolve({
        type,
        duration: Math.max(1, Math.round(duration * fps)),
        width: element.videoWidth,
        height: element.videoHeight,
        hasAudio: true,
      });
      element.src = "";
    };
    element.onerror = () => {
      clearTimeout(timer);
      reject(
        new Error(
          `The browser cannot decode ${file.name}. Try the desktop app.`,
        ),
      );
    };
    element.src = url;
  });
}
async function browserBridge() {
  let initial;
  try {
    initial = validateProject(
      JSON.parse(localStorage.getItem("palmierwin-project")),
    );
  } catch {
    initial = demoProject();
  }
  const store = new ProjectStore(initial),
    listeners = new Set(),
    notices = new Set(),
    urls = new Map();
  const state = () => ({
    project: store.snapshot,
    history: store.history,
    mcpStatus: "desktop-only",
    revision: store.revision,
  });
  for (const media of initial.media)
    if (media.path.startsWith("browser:")) {
      try {
        const file = await dbFile("readonly", media.id);
        if (file) urls.set(media.id, URL.createObjectURL(file));
      } catch {}
    }
  store.subscribe(() => {
    try {
      localStorage.setItem(
        "palmierwin-project",
        JSON.stringify(store.snapshot),
      );
    } catch {
      for (const fn of notices)
        fn("Browser storage is full. Save a project file to keep your edits.");
    }
    for (const fn of listeners) fn(state());
  });
  async function importFiles(files) {
    if (!files.length) return;
    const media = [],
      commands = [];
    for (const file of files) {
      if (file.name.toLowerCase().endsWith(".srt")) {
        commands.push(...parseSrt(await file.text(), store.project.fps));
        continue;
      }
      const id = uid(),
        url = URL.createObjectURL(file),
        info = await inspectFile(file, url, store.project.fps);
      await dbFile("readwrite", id, file);
      urls.set(id, url);
      media.push({ ...info, id, name: file.name, path: `browser:${id}` });
    }
    store.transaction(
      [
        ...(media.length ? [{ action: "import_media", args: { media } }] : []),
        ...commands,
      ],
      "Import media",
    );
    return { media, captions: commands.length };
  }
  return {
    desktop: false,
    state: async () => state(),
    edit: async (a, b) => store.dispatch(a, b),
    transaction: async (c) => store.transaction(c),
    undo: async () => store.undo(),
    redo: async () => store.redo(),
    newProject: async () => store.replace(newProject()),
    loadDemo: async () => store.replace(demoProject()),
    onState: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onNotice: (fn) => {
      notices.add(fn);
      return () => notices.delete(fn);
    },
    onExport: () => () => {},
    importMedia: async () =>
      importFiles(await chooseFiles("video/*,audio/*,image/*,.srt")),
    importDropped: importFiles,
    mediaUrl: (id) => {
      const m = store.project.media.find((m) => m.id === id);
      return m?.path.startsWith("demo:")
        ? new URL(`../../assets/demo/${m.path.slice(5)}`, import.meta.url).href
        : urls.get(id) || "";
    },
    saveProject: async () => {
      download(
        JSON.stringify(store.snapshot, null, 2),
        `${store.project.name}.palmierwin`,
        "application/json",
      );
      return "Downloaded project";
    },
    openProject: async () => {
      const files = await chooseFiles(".palmierwin,.json", false);
      if (!files.length) return;
      const p = validateProject(JSON.parse(await files[0].text()));
      store.replace(p);
    },
    exportVideo: async () => {
      throw new Error(
        "Video encoding is available in the Windows desktop app. You can save the project or capture the current frame from this preview.",
      );
    },
    settings: async () => ({
      endpoint: "https://api.openai.com/v1",
      model: "",
      hasKey: false,
    }),
    saveSettings: async () => {
      throw new Error(
        "Provider credentials are stored with Windows encryption in the desktop app. Open PalmierWin to connect a provider.",
      );
    },
    chat: async () => {
      throw new Error(
        "AI chat and the local MCP server run in the Windows desktop app. The quick-edit buttons work in this preview.",
      );
    },
    window: async () => {},
  };
}
export async function getBridge() {
  return window.palmier ?? (await browserBridge());
}
