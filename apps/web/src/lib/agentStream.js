import { API_BASE } from "@/lib/api";

/**
 * POST /agent/chat SSE client. Multipart when files are attached (files[]),
 * JSON otherwise. Exactly one terminal event (done|error) resolves the run;
 * anything after it is ignored. Rejects on HTTP errors (parsed message) and
 * on abort (DOMException named AbortError).
 */
export async function streamChat({ message, userId, context, readOnly, files = [], signal, onEvent }) {
  let res;
  if (files.length > 0) {
    const form = new FormData();
    form.append("message", message);
    if (userId !== undefined) form.append("userId", String(userId));
    if (context) form.append("context", context);
    if (readOnly) form.append("readOnly", "true");
    for (const file of files.slice(0, 5)) form.append("files", file, file.name);
    res = await fetch(`${API_BASE}/agent/chat`, { method: "POST", credentials: "include", body: form, signal });
  } else {
    res = await fetch(`${API_BASE}/agent/chat`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        ...(userId !== undefined ? { userId } : {}),
        ...(context ? { context } : {}),
        ...(readOnly ? { readOnly: true } : {}),
      }),
      signal,
    });
  }

  if (res.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("arkpay:unauthorized"));
  }
  if (!res.ok || !res.body) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.message) detail = Array.isArray(body.message) ? body.message.join("; ") : String(body.message);
    } catch {
      /* fall through with the status */
    }
    throw new Error(detail);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  const dispatch = (raw) => {
    if (finished) return;
    const typeMatch = /^event:\s*([a-z-]+)/m.exec(raw);
    const dataMatch = /^data:\s*(.*)$/m.exec(raw);
    if (!typeMatch || !dataMatch) return;
    let event;
    try {
      event = JSON.parse(dataMatch[1]);
    } catch {
      return;
    }
    if (event?.type === "done" || event?.type === "error") finished = true;
    onEvent?.({ ...event, type: typeMatch[1] });
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        dispatch(frame);
      }
      if (finished) break;
    }
  } finally {
    try {
      reader.cancel();
    } catch {
      /* already closed */
    }
  }
}
