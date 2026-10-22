import test from "node:test";
import assert from "node:assert/strict";
import { ProjectStore, newProject } from "../src/core/project.mjs";
import { startMcp, createToolRunner } from "../src/desktop/mcp.mjs";

test("MCP edits share the same store and reject unsupported actions", async () => {
  const store = new ProjectStore(newProject());
  const run = createToolRunner({
    store,
    importMedia: async () => ({ media: [] }),
    startExport: async () => ({ status: "rendering" }),
    getExport: () => ({ status: "idle" }),
  });
  await run("edit_timeline", {
    commands: [
      {
        action: "add_text",
        args: { text: "From the agent", start: 0, duration: 90 },
      },
    ],
  });
  assert.equal(store.project.clips[0].text, "From the agent");
  await run("undo");
  assert.equal(store.project.clips.length, 0);
  await assert.rejects(
    () =>
      run("edit_timeline", { commands: [{ action: "__proto__", args: {} }] }),
    /Unknown edit/,
  );
  await assert.rejects(() => run("import_media", { paths: [] }), /1 to 100/);
});
test("Streamable HTTP handles initialize, tools, notifications, errors and blocked web origins", async () => {
  const store = new ProjectStore(newProject());
  let server;
  // Reserve a test-only local port. Production always uses 19789.
  const port = 19891;
  const ready = new Promise((resolve, reject) => {
    server = startMcp({
      port,
      runTool: createToolRunner({ store }),
      onError: reject,
    });
    server.once("listening", resolve);
  });
  await ready;
  try {
    const request = (body, headers = {}) =>
      fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
    const init = await (
      await request({ jsonrpc: "2.0", id: 1, method: "initialize" })
    ).json();
    assert.equal(init.result.serverInfo.name, "palmierwin");
    const tools = await (
      await request({ jsonrpc: "2.0", id: 2, method: "tools/list" })
    ).json();
    assert.ok(tools.result.tools.some((t) => t.name === "edit_timeline"));
    assert.equal(
      (await request({ jsonrpc: "2.0", method: "notifications/initialized" }))
        .status,
      202,
    );
    const edit = await (
      await request({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "edit_timeline",
          arguments: {
            commands: [{ action: "rename", args: { name: "MCP project" } }],
          },
        },
      })
    ).json();
    assert.equal(edit.result.isError, undefined);
    assert.equal(store.project.name, "MCP project");
    const bad = await (
      await request({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "unknown" },
      })
    ).json();
    assert.equal(bad.result.isError, true);
    assert.equal(
      (await request("{}", { Origin: "https://example.com" })).status,
      403,
    );
    assert.equal((await request("{oops")).status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
