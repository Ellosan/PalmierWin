import assert from "node:assert/strict";
import { mkdir, stat, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { connectCdp } from "./cdp.mjs";

const c = await connectCdp(Number(process.env.CDP_PORT || 9223));
let rpcId = 0;
const passed = [];
async function rpc(method, params) {
  const r = await fetch("http://127.0.0.1:19789/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  assert.equal(r.status, 200);
  const value = await r.json();
  assert.ok(!value.error, JSON.stringify(value.error));
  return value.result;
}
async function tool(name, args = {}) {
  const r = await rpc("tools/call", { name, arguments: args });
  if (r.isError) throw new Error(r.content[0].text);
  return JSON.parse(r.content[0].text);
}
async function check(name, fn) {
  await fn();
  passed.push(name);
  console.log(`PASS ${name}`);
}
try {
  await c.send("Runtime.enable");
  await c.send("Log.enable");
  await c.waitFor("!!window.__palmierwin && !!window.palmier");
  await c.evaluate("window.palmier.loadDemo()");
  await check(
    "desktop bridge and Streamable HTTP server initialize",
    async () => {
      assert.equal(await c.evaluate("window.palmier.desktop"), true);
      const init = await rpc("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "smoke", version: "1" },
      });
      assert.equal(init.serverInfo.name, "palmierwin");
    },
  );
  await check(
    "MCP edits immediately appear in the native renderer",
    async () => {
      await tool("edit_timeline", {
        commands: [{ action: "rename", args: { name: "Native smoke test" } }],
      });
      await c.waitFor('window.__palmierwin.project.name==="Native smoke test"');
      assert.equal((await tool("get_timeline")).name, "Native smoke test");
    },
  );
  await check("native media import probes actual file metadata", async () => {
    const result = await tool("import_media", {
      paths: [resolve("assets/demo/headland.png")],
    });
    assert.equal(result.media[0].type, "image");
    assert.equal(result.media[0].width, 1600);
    await c.waitFor("window.__palmierwin.project.media.length===5");
    const url = await c.evaluate(
      `window.palmier.mediaUrl(${JSON.stringify(result.media[0].id)})`,
    );
    assert.ok(url.startsWith("palmier-media://asset/"));
  });
  await check(
    "renderer undo reverts the same edit made through MCP",
    async () => {
      await c.evaluate("window.palmier.undo()");
      await c.waitFor("window.__palmierwin.project.media.length===4");
      assert.equal((await tool("get_media")).length, 4);
    },
  );
  await check("native IPC and MCP share alternate timelines", async () => {
    const p = await tool("get_timeline");
    await c.evaluate(
      'window.palmier.edit("create_timeline",{duplicate:true,name:"Agent cut"})',
    );
    await c.waitFor(
      'window.__palmierwin.project.activeTimeline.name==="Agent cut"',
    );
    assert.equal((await tool("get_timeline")).clips.length, p.clips.length);
    await tool("undo");
  });
  await check(
    "desktop export encodes real video and reports completion",
    async () => {
      await tool("edit_timeline", {
        commands: [
          {
            action: "set_settings",
            args: { width: 320, height: 180, fps: 24 },
          },
        ],
      });
      await mkdir("artifacts", { recursive: true });
      const output = resolve("artifacts/native-export.mp4");
      await rm(output, { force: true });
      const job = await tool("export_project", { output, codec: "h264" });
      assert.equal(job.status, "rendering");
      let state;
      for (let i = 0; i < 300; i++) {
        state = await tool("manage_exports");
        if (state.status !== "rendering") break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.equal(state.status, "completed", state.error);
      assert.equal(state.progress, 100);
      assert.ok((await stat(output)).size > 20000);
      const repeated = await rpc("tools/call", {
        name: "export_project",
        arguments: { output, codec: "h264" },
      });
      assert.equal(repeated.isError, true);
      assert.ok(repeated.content[0].text.includes("already exists"));
    },
  );
  await c.evaluate("window.palmier.loadDemo()");
  await c.waitFor("window.__palmierwin.project.width===1920");
  const exceptions = c.events.filter(
    (e) => e.method === "Runtime.exceptionThrown",
  );
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  await writeFile(
    "artifacts/desktop-smoke-results.json",
    JSON.stringify({ passed, exceptions }, null, 2),
  );
  console.log(`${passed.length} native desktop checks passed.`);
} finally {
  c.close();
}
