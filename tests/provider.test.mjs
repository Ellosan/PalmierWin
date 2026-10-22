import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { NVIDIA_ENDPOINT, NVIDIA_MODEL, environmentKey, readCompletionStream, requestCompletion } from "../src/desktop/provider.mjs";

function stream(text, chunkSize = 7) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
      controller.close();
    },
  });
}
const event = (delta, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\r\n\r\n`;
const options = { endpoint: NVIDIA_ENDPOINT, model: NVIDIA_MODEL, apiKey: "test-key", messages: [{ role: "user", content: "Read the timeline." }], tools: [] };

test("environment credentials never follow a provider change or lookalike URL", () => {
  const env = { NVIDIA_API_KEY: "private-test-key" };
  assert.equal(environmentKey({ endpoint: NVIDIA_ENDPOINT }, env), env.NVIDIA_API_KEY);
  assert.equal(environmentKey({ endpoint: NVIDIA_ENDPOINT + "/" }, env), env.NVIDIA_API_KEY);
  for (const endpoint of ["https://api.openai.com/v1", "https://integrate.api.nvidia.com.evil.test/v1", "http://integrate.api.nvidia.com/v1", NVIDIA_ENDPOINT + "/other"])
    assert.equal(environmentKey({ endpoint }, env), "");
});

test("stream assembles split UTF-8, reasoning and multiple interleaved tool calls", async () => {
  const response = await readCompletionStream(stream(
    ': heartbeat\r\n\r\n' +
    'data: {"choices":[]}\r\n\r\n' +
    event({ reasoning_content: "Private reasoning." }) +
    event({ content: "Café 🌴", tool_calls: [
      { index: 0, id: "a", type: "function", function: { name: "get_", arguments: "{" } },
      { index: 1, id: "b", type: "function", function: { name: "get_media", arguments: "{}" } },
    ] }) +
    event({ tool_calls: [{ index: 0, function: { name: "timeline", arguments: "}" } }] }, "tool_calls") +
    'data: [DONE]\r\n\r\n', 1));
  assert.equal(response.content, "Café 🌴");
  assert.equal(response.reasoning_content, "Private reasoning.");
  assert.deepEqual(response.tool_calls.map(c => [c.id, c.function.name, c.function.arguments]), [
    ["a", "get_timeline", "{}"], ["b", "get_media", "{}"],
  ]);
});

test("a severed stream cannot return a partial edit", async () => {
  await assert.rejects(readCompletionStream(stream(event({ tool_calls: [{ index: 0, id: "a", function: { name: "edit_timeline", arguments: '{"commands":[' } }] }))), /ended before/);
});

test("token limits and malformed tool arguments cannot execute partial edits", async () => {
  await assert.rejects(readCompletionStream(stream(event({ content: "partial" }, "length"))), /before completing/);
  await assert.rejects(readCompletionStream(stream(event({ tool_calls: [{ index: 0, id: "a", function: { name: "edit_timeline", arguments: "{" } }] }, "tool_calls"))), SyntaxError);
});

test("provider stream errors do not expose returned diagnostic data", async () => {
  await assert.rejects(readCompletionStream(stream('data: {"error":{"message":"private diagnostic"}}\n\n')), error => !error.message.includes("private diagnostic") && /interrupted/.test(error.message));
});

test("NVIDIA request uses the supplied generation settings and consumes SSE", async () => {
  const reply = await requestCompletion({ ...options, fetchImpl: async (url, init) => {
    assert.equal(url, NVIDIA_ENDPOINT + "/chat/completions");
    assert.equal(init.headers.Authorization, "Bearer test-key");
    const body = JSON.parse(init.body);
    assert.equal(body.model, NVIDIA_MODEL);
    assert.equal(body.temperature, 1);
    assert.equal(body.top_p, 0.95);
    assert.equal(body.max_tokens, 16384);
    assert.equal(body.stream, true);
    assert.deepEqual(body.chat_template_kwargs, { enable_thinking: true });
    return new Response(stream(event({ content: "Ready" }, "stop")), { headers: { "content-type": "text/event-stream" } });
  } });
  assert.equal(reply.content, "Ready");
});

test("other OpenAI-compatible providers keep their original JSON protocol", async () => {
  const reply = await requestCompletion({ ...options, endpoint: "https://example.test/v1", fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.stream, undefined);
    assert.equal(body.chat_template_kwargs, undefined);
    return Response.json({ choices: [{ message: { role: "assistant", content: "Hello" } }] });
  } });
  assert.equal(reply.content, "Hello");
});

test("busy errors report a useful status without echoing upstream credentials", async () => {
  await assert.rejects(requestCompletion({ ...options, fetchImpl: async () => new Response("private-test-key", { status: 503 }) }), /busy \(HTTP 503\)/);
});

test("network and timeout failures have actionable messages", async () => {
  await assert.rejects(requestCompletion({ ...options, fetchImpl: async () => { throw new TypeError("fetch failed"); } }), /Could not reach/);
  await assert.rejects(requestCompletion({ ...options, fetchImpl: async () => { throw new DOMException("timeout", "TimeoutError"); } }), /timed out/);
});

test("real HTTP transport reconstructs streamed tool calls", async (t) => {
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    assert.equal(JSON.parse(body).model, NVIDIA_MODEL);
    assert.equal(req.headers.authorization, "Bearer test-key");
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(event({ tool_calls: [{ index: 0, id: "call-1", function: { name: "get_timeline", arguments: "{" } }] }));
    setTimeout(() => res.end(event({ tool_calls: [{ index: 0, function: { arguments: "}" } }] }, "tool_calls") + "data: [DONE]\n\n"), 10);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const reply = await requestCompletion({ ...options, endpoint: `http://127.0.0.1:${server.address().port}/v1` });
  assert.equal(reply.tool_calls[0].function.name, "get_timeline");
  assert.equal(reply.tool_calls[0].function.arguments, "{}");
});
