import http from "node:http";

const object = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const id = {
  type: "string",
  description: "ID returned by get_timeline or get_media",
};
const frame = {
  type: "integer",
  minimum: 0,
  description: "Timeline frame, not seconds",
};
export const toolDefinitions = [
  {
    name: "get_timeline",
    description:
      "Read the current PalmierWin project, tracks, clips, markers and frame-based settings.",
    inputSchema: object({}),
  },
  {
    name: "get_media",
    description: "List imported media. Duration is in project frames.",
    inputSchema: object({}),
  },
  {
    name: "edit_timeline",
    description:
      "Apply an atomic, undoable batch of edits. Actions: add_clip(mediaId,trackId,start,duration,sourceIn), add_text(text,start,duration,fontSize,color), update_clip(id,changes), move_clip(id,start,trackId), trim_clip(id,edge,frame), split_clip(id,frame), delete_clip(id,ripple), duplicate_clip(id), set_keyframe(id,property,frame,value), clear_keyframes(id), add_marker(frame,text), delete_marker(id), add_track(type,name), update_track(id,changes), set_settings(width,height,fps), rename(name), create_timeline(name,duplicate), set_active_timeline(id), rename_timeline(name). Frame values are integers. Clip changes may include props: x/y in % of canvas, scale/opacity/volume/brightness/contrast/saturation in %, rotation in degrees, fadeIn/fadeOut in frames. speed 0.1–8. Read get_timeline first.",
    inputSchema: object(
      {
        commands: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: object(
            { action: { type: "string" }, args: { type: "object" } },
            ["action", "args"],
          ),
        },
      },
      ["commands"],
    ),
  },
  {
    name: "import_media",
    description:
      "Import an existing absolute local image, video, audio or SRT path into the open project. Use only files the user asked you to edit.",
    inputSchema: object(
      {
        paths: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 100,
        },
      },
      ["paths"],
    ),
  },
  {
    name: "undo",
    description: "Undo the most recent manual or agent edit.",
    inputSchema: object({}),
  },
  {
    name: "redo",
    description: "Redo an undone edit.",
    inputSchema: object({}),
  },
  {
    name: "export_project",
    description:
      "Render the timeline to a new absolute MP4/MOV path. Existing files are never overwritten through MCP. Returns a background export job.",
    inputSchema: object(
      {
        output: { type: "string" },
        codec: { type: "string", enum: ["h264", "h265", "prores"] },
      },
      ["output"],
    ),
  },
  {
    name: "manage_exports",
    description: "Read the current background video export state.",
    inputSchema: object({}),
  },
];

export function createToolRunner({
  store,
  importMedia,
  startExport,
  getExport,
}) {
  return async (name, args = {}) => {
    if (!args || typeof args !== "object" || Array.isArray(args))
      throw new Error("Tool arguments must be an object.");
    switch (name) {
      case "get_timeline":
        return store.snapshot;
      case "get_media":
        return store.snapshot.media;
      case "edit_timeline":
        if (
          !Array.isArray(args.commands) ||
          !args.commands.length ||
          args.commands.length > 100
        )
          throw new Error("Provide 1 to 100 commands.");
        return {
          results: store.transaction(args.commands, "Agent edit"),
          project: store.snapshot,
        };
      case "import_media":
        if (
          !Array.isArray(args.paths) ||
          !args.paths.length ||
          args.paths.length > 100 ||
          args.paths.some((p) => typeof p !== "string")
        )
          throw new Error("Provide 1 to 100 local paths.");
        return importMedia(args.paths);
      case "undo":
        return { changed: store.undo() };
      case "redo":
        return { changed: store.redo() };
      case "export_project":
        return startExport(args);
      case "manage_exports":
        return getExport();
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };
}

export function startMcp({ runTool, port = 19789, onError = () => {} }) {
  const server = http.createServer(async (req, res) => {
    // No web origins are granted access to this local editing service.
    if (
      req.headers.origin ||
      !["127.0.0.1", "localhost"].some(
        (h) => req.headers.host === `${h}:${port}`,
      )
    ) {
      res.writeHead(403);
      res.end("Local MCP clients only.");
      return;
    }
    if (req.url !== "/mcp") {
      res.writeHead(404);
      res.end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" });
      res.end();
      return;
    }
    let body = "";
    try {
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 2 * 1024 * 1024) {
          res.writeHead(413);
          res.end();
          return;
        }
      }
      let rpc;
      try {
        rpc = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error" },
          }),
        );
        return;
      }
      if (
        !rpc ||
        typeof rpc !== "object" ||
        Array.isArray(rpc) ||
        rpc.jsonrpc !== "2.0" ||
        typeof rpc.method !== "string"
      ) {
        res.writeHead(400);
        res.end();
        return;
      }
      if (rpc.id === undefined) {
        res.writeHead(202);
        res.end();
        return;
      }
      let result, error;
      switch (rpc.method) {
        case "initialize":
          result = {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "palmierwin", version: "0.1.0" },
            instructions:
              "Read get_timeline before editing. Frame values are integers. All edits share the editor undo history.",
          };
          break;
        case "ping":
          result = {};
          break;
        case "tools/list":
          result = { tools: toolDefinitions };
          break;
        case "tools/call":
          try {
            const value = await runTool(
              rpc.params?.name,
              rpc.params?.arguments ?? {},
            );
            result = {
              content: [{ type: "text", text: JSON.stringify(value ?? null) }],
            };
          } catch (e) {
            result = {
              isError: true,
              content: [{ type: "text", text: e.message }],
            };
          }
          break;
        default:
          error = { code: -32601, message: "Method not found" };
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id,
          ...(error ? { error } : { result }),
        }),
      );
    } catch (e) {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  server.on("error", onError);
  server.listen(port, "127.0.0.1");
  return server;
}
