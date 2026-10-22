import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { connectCdp } from "./cdp.mjs";

const c = await connectCdp(Number(process.env.CDP_PORT || 9222));
const failures = [];
const checks = [];
async function check(name, fn) {
  try {
    await fn();
    checks.push(name);
    console.log(`PASS ${name}`);
  } catch (e) {
    failures.push({ name, error: e.message });
    console.error(`FAIL ${name}: ${e.message}`);
  }
}
const click = (selector) =>
  c.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const app = (expression) => c.evaluate(`(async()=>{${expression}})()`);
try {
  await c.send("Emulation.setDeviceMetricsOverride", {
    width: 1600,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await c.send("Runtime.enable");
  await c.send("Log.enable");
  await c.send("Page.navigate", {
    url:
      process.env.PREVIEW_URL ||
      "http://127.0.0.1:4173/src/renderer/index.html",
  });
  await c.waitFor("!!window.__palmierwin");
  await app(`localStorage.removeItem('palmierwin-project');`);
  // The test browser has an isolated profile. Restore the shipped sample through the UI.
  await click("#project-menu-button");
  await click('[data-command="demo"]');
  await c.waitFor('!!document.querySelector("#confirm-action")');
  await click("#confirm-action");
  await c.waitFor("window.__palmierwin.project.clips.length===6");
  await app(`window.__palmierwin.seek(60);`);
  await new Promise((r) => setTimeout(r, 250));
  await check("sample media loads without an offline error", async () => {
    assert.equal(
      await c.evaluate('document.querySelectorAll(".media-card").length'),
      4,
    );
    assert.equal(
      await c.evaluate(
        'document.querySelector("#toasts").innerText.includes("unavailable")',
      ),
      false,
    );
  });
  await check("frame stepping and playback advance the playhead", async () => {
    await click("#frame-forward");
    assert.equal(await c.evaluate("window.__palmierwin.frame"), 61);
    await click("#play");
    await new Promise((r) => setTimeout(r, 250));
    await click("#play");
    assert.ok(await c.evaluate("window.__palmierwin.frame>61"));
  });
  await check(
    "split, undo, redo operate through the visible controls",
    async () => {
      await app(
        `window.__palmierwin.select(window.__palmierwin.project.clips.find(c=>c.type==='video').id);window.__palmierwin.seek(120);`,
      );
      await c.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "k",
        code: "KeyK",
        modifiers: 2,
      });
      await c.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "k",
        code: "KeyK",
        modifiers: 2,
      });
      await c.waitFor("window.__palmierwin.project.clips.length===7");
      await click("#undo");
      await c.waitFor("window.__palmierwin.project.clips.length===6");
      await click("#redo");
      await c.waitFor("window.__palmierwin.project.clips.length===7");
      await click("#undo");
    },
  );
  await check(
    "inspector edits persist and reject invalid source trims",
    async () => {
      await app(
        `window.__palmierwin.select(window.__palmierwin.project.clips.find(c=>c.type==='video').id);`,
      );
      await app(
        `const input=document.querySelector('#prop-scale');input.value=120;input.dispatchEvent(new Event('change',{bubbles:true}));`,
      );
      await c.waitFor(
        'window.__palmierwin.project.clips.find(c=>c.type==="video").props.scale===120',
      );
      const before = await c.evaluate(
        'window.__palmierwin.project.clips.find(c=>c.type==="video").duration',
      );
      await app(
        `await window.__palmierwin.edit('update_clip',{id:window.__palmierwin.selected,changes:{duration:99999}});`,
      );
      assert.equal(
        await c.evaluate(
          'window.__palmierwin.project.clips.find(c=>c.type==="video").duration',
        ),
        before,
      );
      await click("#undo");
    },
  );
  await check("new/alternate timelines preserve the original cut", async () => {
    const old = await c.evaluate(
      "window.__palmierwin.project.activeTimeline.id",
    );
    await click("#new-timeline");
    await c.waitFor("window.__palmierwin.project.clips.length===0");
    await click(`[data-timeline="${old}"]`);
    await c.waitFor("window.__palmierwin.project.clips.length===6");
    assert.equal(
      await c.evaluate("window.__palmierwin.project.timelines.length"),
      1,
    );
    await click("#undo");
    await click("#undo");
  });
  await check(
    "agent dock and deterministic vertical quick edit work",
    async () => {
      await click("#chat-toggle");
      assert.equal(
        await c.evaluate(
          'document.querySelector(".app-shell").classList.contains("agent-mode")',
        ),
        true,
      );
      await click('[data-quick="vertical"]');
      await c.waitFor("window.__palmierwin.project.height===1920");
      assert.equal(await c.evaluate("window.__palmierwin.project.width"), 1080);
      await click("#undo");
      await click("#chat-toggle");
    },
  );
  await check("settings apply a real format change", async () => {
    await click("#settings-button");
    await app(
      `document.querySelector('#setting-preset').value='1080,1080';document.querySelector('#setting-preset').dispatchEvent(new Event('change'));document.querySelector('#settings-form').requestSubmit();`,
    );
    await c.waitFor(
      "window.__palmierwin.project.width===1080 && window.__palmierwin.project.height===1080",
    );
    await click("#undo");
  });
  await check("SRT import creates actual timed captions", async () => {
    const count = await c.evaluate("window.__palmierwin.project.clips.length");
    await app(
      `const file=new File([${JSON.stringify("1\n00:00:01,000 --> 00:00:02,000\nA caption")}], 'captions.srt',{type:'application/x-subrip'});const data=new DataTransfer();data.items.add(file);document.dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));`,
    );
    await c.waitFor(`window.__palmierwin.project.clips.length===${count + 1}`);
    assert.ok(
      await c.evaluate(
        'window.__palmierwin.project.clips.some(c=>c.text==="A caption" && c.start===30 && c.duration===30)',
      ),
    );
    await click("#undo");
  });
  await check(
    "local media import survives a reload through IndexedDB",
    async () => {
      await app(
        `const response=await fetch('../../assets/demo/headland.png');const file=new File([await response.blob()],'imported.png',{type:'image/png'});const data=new DataTransfer();data.items.add(file);document.dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));`,
      );
      await c.waitFor("window.__palmierwin.project.media.length===5");
      await c.send("Page.reload", { ignoreCache: true });
      await c.waitFor(
        "!!window.__palmierwin && window.__palmierwin.project.media.length===5",
      );
      const images = await c.evaluate(
        '[...document.querySelectorAll(".media-card img")].map(i=>({src:i.src,complete:i.complete}))',
      );
      assert.ok(images.some((i) => i.src.startsWith("blob:")));
    },
  );
  await check(
    "export preview clearly identifies desktop-only video encoding",
    async () => {
      await click("#export-button");
      assert.ok(
        await c.evaluate(
          'document.querySelector("#modal").innerText.includes("Windows desktop app required")',
        ),
      );
      await click("#export-cancel");
    },
  );
  await check("workspace fits a 1080×720 desktop window", async () => {
    await c.send("Emulation.setDeviceMetricsOverride", {
      width: 1080,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const dims = await c.evaluate(
      "({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,view:[innerWidth,innerHeight]})",
    );
    assert.equal(dims.width, dims.view[0]);
    assert.equal(dims.height, dims.view[1]);
  });
  // Reset the test profile to a clean, useful sample before making review artifacts.
  await c.send("Emulation.setDeviceMetricsOverride", {
    width: 1600,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await click("#project-menu-button");
  await click('[data-command="demo"]');
  await c.waitFor('!!document.querySelector("#confirm-action")');
  await click("#confirm-action");
  await c.waitFor("window.__palmierwin.project.media.length===4");
  await app(`window.__palmierwin.seek(60);`);
  await new Promise((r) => setTimeout(r, 350));
  await app(`document.querySelector('#toasts').replaceChildren();`);
  await mkdir("artifacts", { recursive: true });
  for (const [name, action] of [
    ["workspace", null],
    ["agent", () => click("#chat-toggle")],
  ]) {
    if (action) await action();
    const shot = await c.send("Page.captureScreenshot", { format: "png" });
    await writeFile(`artifacts/${name}.png`, Buffer.from(shot.data, "base64"));
  }
  await click("#chat-toggle");
  const exceptions = c.events.filter(
    (e) => e.method === "Runtime.exceptionThrown",
  );
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  await writeFile(
    "artifacts/smoke-results.json",
    JSON.stringify({ passed: checks, failures, exceptions }, null, 2),
  );
  console.log(
    `${checks.length} checks passed, ${failures.length} failed; no uncaught browser exceptions.`,
  );
} finally {
  c.close();
}
if (failures.length) process.exitCode = 1;
