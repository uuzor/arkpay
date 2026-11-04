import { useEffect, useMemo, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles, X, ArrowDown } from "lucide-react";
import AgentMessage from "@/components/arkay/ai/AgentMessage";
import Composer from "@/components/arkay/ai/Composer";
import { useAuth } from "@/lib/AuthContext";
import { apiJson } from "@/lib/api";
import { streamChat } from "@/lib/agentStream";
import {
  AGENT_GREETING_TEXT,
  chipsForPath,
  contextForPath,
  contextLabel,
  finishTurn,
  getChatUserId,
  newAgentTurn,
  newUserTurn,
  turnId,
} from "@/lib/chatTurns";

function greetingTurn() {
  return {
    ...finishTurn({ ...newAgentTurn(), text: AGENT_GREETING_TEXT }),
    quiet: true,
  };
}

export default function AgentBar({ open, onClose, readOnly = false }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const queryClient = useQueryClient();
  const { workspace } = useAuth();
  const [turns, setTurns] = useState([]);
  const [liveTurn, setLiveTurn] = useState(null);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState([]);
  const [stuck, setStuck] = useState(true);
  const [historyState, setHistoryState] = useState("idle"); // idle | loading | ready | error
  const scroller = useRef(null);
  const aborter = useRef(null);
  const loadedFor = useRef(null);
  // Mirror of liveTurn for terminal handlers: setState updaters must be pure
  // (StrictMode double-invokes them), so terminal events read the ref instead
  // of nesting setTurns inside a setLiveTurn updater.
  const liveRef = useRef(null);

  const chips = chipsForPath(pathname);
  const busy = liveTurn != null;
  const userId = useMemo(
    () => getChatUserId(workspace?.telegramLink?.telegramId ?? null),
    [workspace?.telegramLink?.telegramId],
  );

  // History replay on first open: persisted user/assistant turns, oldest first.
  useEffect(() => {
    if (!open || historyState !== "idle" || workspace === undefined) return;
    const key = userId === undefined ? "linked" : String(userId);
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    setHistoryState("loading");
    const params = new URLSearchParams({ limit: "200" });
    if (userId !== undefined) params.set("userId", String(userId));
    apiJson(`/agent/messages?${params.toString()}`)
      .then((res) => {
        const rows = res?.messages ?? [];
        if (!rows.length) {
          setTurns([greetingTurn()]);
        } else {
          setTurns(
            rows.map((row) =>
              row.role === "assistant"
                ? { ...finishTurn({ ...newAgentTurn(), text: row.content ?? "" }), id: row.id ?? turnId("hist"), quiet: true }
                : { id: row.id ?? turnId("hist"), role: "user", text: row.content ?? "", attachments: [], createdAt: row.createdAt },
            ),
          );
        }
        setHistoryState("ready");
      })
      .catch(() => {
        loadedFor.current = null;
        setHistoryState("error");
      });
  }, [open, historyState, userId, workspace]);

  useEffect(() => () => aborter.current?.abort(), []);

  useEffect(() => {
    const el = scroller.current;
    if (el && stuck) el.scrollTop = el.scrollHeight;
  }, [turns, liveTurn, open, stuck]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  };

  const commitLive = (next) => {
    liveRef.current = next;
    setLiveTurn(next);
  };
  const patchLive = (fn) => {
    if (liveRef.current) commitLive(fn(liveRef.current));
  };
  const finishLive = (fn) => {
    const live = liveRef.current;
    if (!live) return;
    commitLive(null);
    const finished = fn(live);
    setTurns((all) => [...all, finished]);
  };

  const submit = (text) => {
    const question = (text ?? input).trim();
    if ((!question && files.length === 0) || busy) return;

    const userTurn = newUserTurn(question, files);
    const sendFiles = files;
    setTurns((all) => [...all, userTurn]);
    setInput("");
    setFiles([]);
    setStuck(true);
    commitLive(newAgentTurn());

    const controller = new AbortController();
    aborter.current = controller;
    streamChat({
      message: question,
      userId,
      context: contextForPath(pathname),
      readOnly,
      files: sendFiles,
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "text-delta") {
          patchLive((live) => ({ ...live, text: live.text + (event.text ?? "") }));
        } else if (event.type === "tool-call") {
          patchLive((live) => ({
            ...live,
            toolCalls: [
              ...live.toolCalls,
              { id: event.toolCallId, name: event.toolName, input: event.input, status: "running", startedAt: Date.now() },
            ],
          }));
        } else if (event.type === "tool-result") {
          patchLive((live) => ({
            ...live,
            toolCalls: live.toolCalls.map((c) =>
              c.id === event.toolCallId
                ? { ...c, status: "done", output: event.output, finishedAt: Date.now() }
                : c,
            ),
          }));
        } else if (event.type === "draft") {
          patchLive((live) => ({ ...live, draft: event.draft }));
          // The server persisted a real PENDING_APPROVAL action — the queue
          // is the source of truth from here, not a local draft copy.
          queryClient.invalidateQueries({ queryKey: ["approvals"] });
        } else if (event.type === "document") {
          patchLive((live) => ({
            ...live,
            document: {
              filename: event.filename,
              mimeType: event.mimeType,
              size: event.size,
              base64: event.base64,
            },
          }));
        } else if (event.type === "done") {
          finishLive((live) => finishTurn(live));
        } else if (event.type === "error") {
          finishLive((live) => finishTurn(live, event.message || "Chat failed."));
        }
      },
    }).catch((e) => {
      const aborted = e?.name === "AbortError";
      finishLive((live) => {
        const text = live.text || (aborted ? "Stopped." : "");
        return finishTurn({ ...live, text }, aborted ? null : (e?.message ?? "Chat failed."));
      });
    });
  };

  const stop = () => aborter.current?.abort();

  return (
    <aside
      className={`fixed inset-0 z-50 flex flex-col border-mist/70 bg-paper lg:inset-y-0 lg:left-auto lg:right-0 lg:top-14 lg:z-20 lg:w-[360px] lg:border-l ${
        open ? "" : "hidden"
      }`}
      aria-label="Arkay agent"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-mist/60 px-3">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-ember/10 text-ember">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-ink">Arkay agent</p>
          <p className="truncate text-[10px] text-steel">{contextLabel(pathname)}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close agent"
          className="ml-auto grid h-7 w-7 place-items-center rounded-lg text-steel hover:bg-fog hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          onScroll={onScroll}
          role="log"
          aria-label="Agent conversation"
          className="h-full space-y-4 overflow-y-auto px-3 py-3"
        >
          {historyState === "loading" && turns.length === 0 ? (
            <div className="space-y-2">
              <div className="h-12 animate-pulse rounded-xl bg-fog" />
              <div className="h-24 animate-pulse rounded-xl bg-fog" />
            </div>
          ) : null}
          {historyState === "error" ? (
            <p className="rounded-lg bg-fog/70 px-3 py-2 text-[11.5px] text-graphite">
              Couldn't load chat history — new messages still work.
            </p>
          ) : null}
          {turns.map((turn) => (
            <AgentMessage key={turn.id} message={turn} />
          ))}
          {liveTurn ? <AgentMessage key={liveTurn.id} message={liveTurn} /> : null}
        </div>
        {!stuck ? (
          <button
            type="button"
            onClick={() => {
              setStuck(true);
              const el = scroller.current;
              if (el) el.scrollTop = el.scrollHeight;
            }}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-mist/70 bg-paper px-3 py-1.5 text-[11.5px] font-medium text-ink shadow-quo"
          >
            <ArrowDown className="h-3 w-3" /> Scroll to latest
          </button>
        ) : null}
      </div>

      {turns.length <= 1 && !busy && historyState !== "loading" ? (
        <div className="flex flex-wrap gap-1.5 px-3 pb-2">
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => submit(c)}
              className="rounded-lg border border-mist/70 px-2 py-1 text-[11px] text-graphite hover:border-ink/30 hover:text-ink"
            >
              {c}
            </button>
          ))}
        </div>
      ) : null}

      <Composer
        input={input}
        onInput={setInput}
        onSend={() => submit()}
        onStop={stop}
        busy={busy}
        files={files}
        onFiles={(picked) => setFiles((all) => [...all, ...picked].slice(0, 5))}
        onRemoveFile={(i) => setFiles((all) => all.filter((_, j) => j !== i))}
        readOnly={readOnly}
      />
    </aside>
  );
}
