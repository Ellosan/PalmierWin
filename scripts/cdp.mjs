export async function connectCdp(port = 9222) {
  const pages = await (
    await fetch(`http://127.0.0.1:${port}/json/list`)
  ).json();
  const target = pages.find((p) => p.type === "page");
  if (!target) throw new Error("No test browser page.");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const pending = new Map(),
    events = [];
  let id = 0;
  ws.onmessage = (e) => {
    const message = JSON.parse(e.data);
    if (message.id) {
      const p = pending.get(message.id);
      if (p) {
        pending.delete(message.id);
        message.error
          ? p.reject(new Error(message.error.message))
          : p.resolve(message.result);
      }
    } else events.push(message);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text,
      );
    return result.result.value;
  };
  const waitFor = async (expression) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Timed out waiting for ${expression}`);
  };
  return { send, evaluate, waitFor, events, close: () => ws.close() };
}
