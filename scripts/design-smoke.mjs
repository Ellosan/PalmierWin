import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { connectCdp } from "./cdp.mjs";

const c = await connectCdp(Number(process.env.CDP_PORT || 9222));
const passed = [];
const click = (selector) =>
  c.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const focus = (selector) =>
  c.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
const active = () =>
  c.evaluate(
    "document.activeElement.id || document.activeElement.dataset.command || document.activeElement.dataset.context",
  );
async function key(key, code = key) {
  const virtual = {
    " ": 32,
    Enter: 13,
    Escape: 27,
    Tab: 9,
    Home: 36,
    End: 35,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
  }[key];
  const event = {
    key,
    code,
    ...(virtual
      ? { windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual }
      : {}),
  };
  await c.send("Input.dispatchKeyEvent", { type: "keyDown", ...event });
  await c.send("Input.dispatchKeyEvent", { type: "keyUp", ...event });
}
async function check(name, fn) {
  await fn();
  passed.push(name);
  console.log(`PASS ${name}`);
}
async function viewport(width, height) {
  await c.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
}
async function screenshot(name) {
  await new Promise((resolve) => setTimeout(resolve, 200));
  const result = await c.send("Page.captureScreenshot", { format: "png" });
  await writeFile(`artifacts/${name}.png`, Buffer.from(result.data, "base64"));
}
try {
  await mkdir("artifacts", { recursive: true });
  await c.send("Runtime.enable");
  await c.send("Log.enable");
  await viewport(1440, 900);
  await c.send("Page.navigate", {
    url: "http://127.0.0.1:4173/src/renderer/index.html",
  });
  await c.waitFor("!!window.__palmierwin");
  await c.evaluate("window.__palmierwin.seek(60)");

  await check(
    "Space activates the focused project menu without starting playback",
    async () => {
      await focus("#project-menu-button");
      await key(" ", "Space");
      assert.equal(
        await c.evaluate(
          'document.querySelector("#project-menu-button").getAttribute("aria-expanded")',
        ),
        "true",
      );
      assert.equal(await active(), "new");
      assert.equal(
        await c.evaluate(
          'document.querySelector("#play").getAttribute("aria-label")',
        ),
        "Play",
      );
    },
  );
  await check(
    "project menu supports arrows, Home, End, typeahead, Escape and focus return",
    async () => {
      await key("ArrowDown");
      assert.equal(await active(), "open");
      await key("End");
      assert.equal(await active(), "demo");
      await key("Home");
      assert.equal(await active(), "new");
      await key("s", "KeyS");
      assert.equal(await active(), "save");
      await key("Escape");
      assert.equal(await active(), "project-menu-button");
      assert.equal(
        await c.evaluate(
          'document.querySelector("#project-menu-button").getAttribute("aria-expanded")',
        ),
        "false",
      );
    },
  );
  await check("menu letter keys do not trigger timeline edits", async () => {
    const count = await c.evaluate("window.__palmierwin.project.clips.length");
    await key("ArrowDown");
    await key("t", "KeyT");
    assert.equal(
      await c.evaluate("window.__palmierwin.project.clips.length"),
      count,
    );
    assert.equal(
      await c.evaluate('document.querySelector("#modal").open'),
      false,
    );
    await key("Escape");
  });
  await check(
    "library tabs activate with arrows and expose matching panels",
    async () => {
      await focus('[data-library="media"]');
      await key("ArrowRight");
      assert.equal(await active(), "generate-tab");
      assert.equal(
        await c.evaluate(
          'document.querySelector("#generate-panel").classList.contains("hidden")',
        ),
        false,
      );
      await key("ArrowLeft");
      assert.equal(await active(), "media-tab");
      assert.equal(
        await c.evaluate(
          'document.querySelector("#media-panel").getAttribute("aria-labelledby")',
        ),
        "media-tab",
      );
    },
  );
  await check(
    "settings dialog has a name, starts in its form and restores focus",
    async () => {
      await focus("#settings-button");
      await key(" ", "Space");
      assert.equal(
        await c.evaluate(
          'document.querySelector("#modal").getAttribute("aria-labelledby")',
        ),
        "modal-title",
      );
      assert.equal(await active(), "setting-width");
      await click("#settings-project-tab");
      await focus("#settings-project-tab");
      await key("ArrowDown");
      assert.equal(await active(), "settings-ai-tab");
      assert.equal(
        await c.evaluate(
          'document.querySelector("#settings-ai").classList.contains("hidden")',
        ),
        false,
      );
      await key("ArrowDown");
      assert.equal(await active(), "settings-updates-tab");
      await c.waitFor('!!document.querySelector("#update-channel")');
      assert.equal(
        await c.evaluate('document.querySelector("#update-channel").disabled'),
        true,
      );
      await key("Escape");
      await c.waitFor('!document.querySelector("#modal").open');
      assert.equal(await active(), "settings-button");
    },
  );
  await check(
    "Space selects a timeline clip and preserves keyboard focus",
    async () => {
      await focus("[data-clip]");
      await key(" ", "Space");
      assert.equal(
        await c.evaluate(
          "document.activeElement.dataset.clip === window.__palmierwin.selected",
        ),
        true,
      );
      assert.equal(
        await c.evaluate('document.activeElement.getAttribute("aria-pressed")'),
        "true",
      );
      assert.equal(
        await c.evaluate(
          'document.querySelector("#play").getAttribute("aria-label")',
        ),
        "Play",
      );
    },
  );
  await check(
    "context menus support keyboard navigation and restore the clip focus",
    async () => {
      await c.evaluate(
        'document.activeElement.dispatchEvent(new MouseEvent("contextmenu", {bubbles:true,cancelable:true,clientX:300,clientY:600}))',
      );
      await c.waitFor(
        '!document.querySelector("#context-menu").classList.contains("hidden")',
      );
      assert.equal(
        await c.evaluate(
          'document.activeElement.closest("#context-menu") !== null',
        ),
        true,
      );
      await key("End");
      assert.equal(
        await c.evaluate(
          'document.activeElement.matches("#context-menu button:not(:disabled):last-child")',
        ),
        true,
      );
      await key("Escape");
      assert.equal(
        await c.evaluate(
          "document.activeElement.dataset.clip === window.__palmierwin.selected",
        ),
        true,
      );
    },
  );
  await check(
    "error notices remain dismissible without stealing focus",
    async () => {
      await focus("#settings-button");
      await c.evaluate(
        '(async()=>{const {toast}=await import("./ui.mjs");toast("Preview error — dismiss when ready",true)})()',
      );
      assert.equal(await active(), "settings-button");
      assert.equal(
        await c.evaluate(
          'document.querySelector(".toast.error").getAttribute("role")',
        ),
        "alert",
      );
      await click(".toast-dismiss");
      assert.equal(
        await c.evaluate('document.querySelectorAll(".toast.error").length'),
        0,
      );
    },
  );
  await check(
    "reduced motion keeps menus usable without surface animations",
    async () => {
      await c.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
      await click("#project-menu-button");
      assert.equal(
        await c.evaluate(
          'getComputedStyle(document.querySelector("#project-menu")).animationName',
        ),
        "none",
      );
      await key("Escape");
      await c.send("Emulation.setEmulatedMedia", { features: [] });
    },
  );
  await check("main labels and keyboard focus are readable", async () => {
    const sizes = await c.evaluate(
      '[".media-card strong", ".clip-label", ".statusbar", ".panel-tabs button"].map(s=>parseFloat(getComputedStyle(document.querySelector(s)).fontSize))',
    );
    assert.ok(sizes.every((size) => size >= 11));
    await focus("#settings-button");
    assert.equal(
      await c.evaluate("getComputedStyle(document.activeElement).outlineWidth"),
      "2px",
    );
  });
  await check(
    "update channel, download progress and restart controls follow the updater state",
    async () => {
      await click("#settings-button");
      await click("#settings-updates-tab");
      await c.waitFor('!!document.querySelector(".update-settings")');
      await c.evaluate(`(async()=>{
      document.querySelector('.update-settings').remove();
      const {mountUpdates}=await import('./updates.mjs');
      const listeners=new Set();
      window.updateFixture={currentVersion:'0.1.2-beta.1',channel:'beta',automatic:true,supported:true,canInstall:true,phase:'idle',message:'Check GitHub for updates.',progress:0};
      const emit=()=>{for(const fn of listeners)fn({...updateFixture});return {...updateFixture}};
      await mountUpdates({desktop:true,updates:async()=>({...updateFixture}),onUpdate:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},
        configureUpdates:async prefs=>{Object.assign(updateFixture,prefs);return emit()},
        checkUpdates:async()=>{Object.assign(updateFixture,{phase:'available',availableVersion:'0.2.0',message:'Version 0.2.0 is available.'});return emit()},
        downloadUpdate:async()=>{Object.assign(updateFixture,{phase:'downloading',progress:52,message:'Downloading and verifying the update…'});emit();await new Promise(r=>setTimeout(r,150));Object.assign(updateFixture,{phase:'ready',progress:100,message:'Update ready.'});return emit()},
        installUpdate:async()=>{Object.assign(updateFixture,{phase:'installing',message:'Restarting to install…'});return emit()},openReleases:async()=>{}});
    })()`);
      await c.evaluate(
        'document.querySelector("#update-channel").value="stable";document.querySelector("#update-channel").dispatchEvent(new Event("change"))',
      );
      await c.waitFor('window.updateFixture.channel==="stable"');
      await click("#check-updates");
      await c.waitFor(
        '!document.querySelector("#download-update").classList.contains("hidden")',
      );
      await click("#download-update");
      await c.waitFor('document.querySelector("#update-progress").value===52');
      assert.equal(
        await c.evaluate('document.querySelector("#update-channel").disabled'),
        true,
      );
      await c.waitFor(
        '!document.querySelector("#install-update").classList.contains("hidden")',
      );
      await screenshot("design-updates-ready");
      await click("#install-update");
      await c.waitFor('window.updateFixture.phase==="installing"');
      await key("Escape");
    },
  );
  await c.evaluate("window.__palmierwin.select(null)");
  for (const [width, height] of [
    [1080, 720],
    [1440, 900],
    [1920, 1080],
  ]) {
    await check(
      `editor and agent fit the supported ${width}×${height} desktop`,
      async () => {
        await viewport(width, height);
        for (const mode of ["editor", "agent"]) {
          if (mode === "agent") await click("#chat-toggle");
          const layout = await c.evaluate(`JSON.stringify({
          overflow: document.documentElement.scrollWidth > innerWidth,
          exportRight: document.querySelector('#export-button').getBoundingClientRect().right,
          canvasHeight: document.querySelector('#canvas-area').getBoundingClientRect().height,
          bottom: document.querySelector('.timeline').getBoundingClientRect().bottom
        })`);
          const metrics = JSON.parse(layout);
          assert.equal(metrics.overflow, false, `${mode} horizontal overflow`);
          assert.ok(
            metrics.exportRight <= width && metrics.canvasHeight >= 100,
          );
          assert.ok(metrics.bottom <= height + 1, `${mode} timeline clipped`);
          await screenshot(`design-${mode}-${width}`);
        }
        await click("#chat-toggle");
      },
    );
  }
  assert.equal(
    c.events.filter((e) => e.method === "Runtime.exceptionThrown").length,
    0,
  );
  await writeFile(
    "artifacts/design-checks.json",
    JSON.stringify({ passed }, null, 2),
  );
  console.log(`${passed.length} design interaction checks passed.`);
} finally {
  c.close();
}
