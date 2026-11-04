import { useState } from "react";
import { Sparkles, Copy, Check, Timer, AlertTriangle, FileDown } from "lucide-react";
import Markdown from "@/components/arkay/ai/Markdown";
import ToolCallGroup from "@/components/arkay/ai/ToolCalls";
import DraftCard from "@/components/arkay/ai/DraftCard";
import { elapsedText } from "@/lib/chatTurns";

function downloadDocument(doc) {
  const url = `data:${doc.mimeType};base64,${doc.base64}`;
  const a = document.createElement("a");
  a.href = url;
  a.download = doc.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function AgentTurn({ turn }) {
  const [copied, setCopied] = useState(false);
  const live = turn.finishedAt == null && !turn.error;
  const empty =
    !turn.text && turn.toolCalls.length === 0 && !turn.draft && !turn.document && !turn.error;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(turn.text || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no toast in the panel */
    }
  };

  return (
    <div className="group/agent-message relative flex gap-2" data-agent-message="">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md bg-ember/10 text-ember">
        <Sparkles className="h-3 w-3" />
      </span>
      <div className="min-w-0 flex-1">
        {empty ? (
          <p className="text-[11.5px] text-steel">
            thinking<span className="animate-pulse">…</span>
          </p>
        ) : (
          <>
            {turn.toolCalls.length > 0 ? (
              <div className="mb-2">
                <ToolCallGroup calls={turn.toolCalls} defaultOpen={live} />
              </div>
            ) : null}
            {turn.text ? <Markdown text={turn.text} /> : null}
            {turn.document ? (
              <button
                type="button"
                onClick={() => downloadDocument(turn.document)}
                className="mt-2 flex w-full items-center gap-2 rounded-xl border border-mist/70 bg-paper px-3 py-2 text-left transition-colors hover:bg-fog/50"
              >
                <FileDown className="h-4 w-4 shrink-0 text-steel" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-ink">{turn.document.filename}</span>
                  <span className="block text-[10.5px] text-steel">
                    {(turn.document.size / 1024).toFixed(1)} KB · tap to download
                  </span>
                </span>
              </button>
            ) : null}
            {turn.draft ? <DraftCard draft={turn.draft} /> : null}
            {turn.error ? (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 px-2.5 py-2 text-[11.5px] leading-4 text-red-700 ring-1 ring-inset ring-red-100">
                <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                {turn.error}
              </p>
            ) : null}
            {!turn.quiet ? (
            <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-steel">
              <Timer className="h-3 w-3" />
              {live ? "Working…" : elapsedText(turn.startedAt, turn.finishedAt)}
              {turn.text && !live ? (
                <button
                  type="button"
                  onClick={copy}
                  aria-label="Copy"
                  className="ml-auto grid h-6 w-6 place-items-center rounded-md text-steel opacity-0 transition-opacity hover:bg-fog hover:text-ink group-hover/agent-message:opacity-100 focus-visible:opacity-100"
                >
                  {copied ? <Check className="h-3 w-3 text-emerald-600" strokeWidth={3} /> : <Copy className="h-3 w-3" />}
                </button>
              ) : null}
            </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
