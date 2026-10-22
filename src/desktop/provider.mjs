export const NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1";
export const NVIDIA_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";

export const isNvidiaEndpoint = (endpoint) =>
  String(endpoint).replace(/\/+$/, "") === NVIDIA_ENDPOINT;

export function environmentKey(settings, env = process.env) {
  return isNvidiaEndpoint(settings.endpoint) ? env.NVIDIA_API_KEY || "" : "";
}

// Keep incomplete tool arguments private until the entire response finishes.
export async function readCompletionStream(body) {
  const reply = { role: "assistant", content: "" };
  const calls = new Map();
  let buffer = "",
    size = 0,
    finished = false;
  function event(value) {
    const data = value
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    if (data === "[DONE]") {
      finished = true;
      return;
    }
    const chunk = JSON.parse(data);
    if (chunk.error)
      throw new Error("The provider interrupted its response. Try again.");
    const choice = chunk.choices?.[0];
    if (!choice) return;
    if (["length", "content_filter"].includes(choice.finish_reason))
      throw new Error(
        "The provider stopped before completing its response. Try a smaller request.",
      );
    if (choice.finish_reason) finished = true;
    const delta = choice.delta || {};
    if (delta.content) reply.content += delta.content;
    // Preserve reasoning for subsequent tool turns, but never display it as the answer.
    if (delta.reasoning_content)
      reply.reasoning_content =
        (reply.reasoning_content || "") + delta.reasoning_content;
    for (const call of delta.tool_calls || []) {
      const tool = calls.get(call.index) || {
        id: "",
        type: "function",
        function: { name: "", arguments: "" },
      };
      if (call.id) tool.id = call.id;
      if (call.type) tool.type = call.type;
      tool.function.name += call.function?.name || "";
      tool.function.arguments += call.function?.arguments || "";
      calls.set(call.index, tool);
    }
  }
  for await (const text of body.pipeThrough(new TextDecoderStream())) {
    size += text.length;
    if (size > 8 * 1024 * 1024)
      throw new Error("The provider response was too large.");
    buffer += text;
    // Split on blank SSE lines, including CRLF fragmented across network chunks.
    let match;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      event(buffer.slice(0, match.index).replaceAll("\r\n", "\n"));
      buffer = buffer.slice(match.index + match[0].length);
    }
  }
  if (buffer.trim()) event(buffer.replaceAll("\r\n", "\n"));
  if (!finished)
    throw new Error(
      "The provider connection ended before its response finished. Try again.",
    );
  if (calls.size) {
    reply.tool_calls = [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => {
        if (!call.id || !call.function.name)
          throw new Error("The provider returned an incomplete tool call.");
        JSON.parse(call.function.arguments);
        return call;
      });
  }
  return reply;
}

export async function requestCompletion({
  endpoint,
  model,
  apiKey,
  messages,
  tools,
  fetchImpl = fetch,
  timeoutMs = 600000,
}) {
  const nvidia = isNvidiaEndpoint(endpoint);
  try {
    const response = await fetchImpl(
      `${endpoint.replace(/\/+$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          tools,
          ...(nvidia
            ? {
                temperature: 1,
                top_p: 0.95,
                max_tokens: 16384,
                chat_template_kwargs: { enable_thinking: true },
                stream: true,
              }
            : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!response.ok) {
      if ([429, 502, 503, 504].includes(response.status))
        throw new Error(
          `The provider is busy (HTTP ${response.status}). Try again shortly.`,
        );
      throw new Error(
        `The provider returned HTTP ${response.status}. Check your endpoint, model and key.`,
      );
    }
    if (response.headers.get("content-type")?.includes("text/event-stream"))
      return await readCompletionStream(response.body);
    const body = await response.json();
    if (!body.choices?.[0]?.message)
      throw new Error("The provider returned no message.");
    return body.choices[0].message;
  } catch (error) {
    if (["TimeoutError", "AbortError"].includes(error.name))
      throw new Error(
        "The provider timed out. Try again shortly or use a smaller request.",
      );
    if (error instanceof TypeError)
      throw new Error(
        "Could not reach the provider. Check your connection and API base URL.",
      );
    throw error;
  }
}
