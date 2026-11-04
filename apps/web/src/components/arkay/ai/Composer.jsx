import { useRef } from "react";
import { ArrowUp, Square, Paperclip, X, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

const ACCEPT = ".pdf,.txt,.csv,.md,.json,.mp3,.m4a,.wav,.webm,.ogg,.oga,.png,.jpg,.jpeg,.webp,.gif,audio/*,image/*,text/*";

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function Composer({
  input,
  onInput,
  onSend,
  onStop,
  busy,
  files,
  onFiles,
  onRemoveFile,
  readOnly,
  disabled,
}) {
  const area = useRef(null);
  const picker = useRef(null);

  const autosize = () => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const submit = () => {
    if (busy || (!input.trim() && files.length === 0)) return;
    onSend();
    requestAnimationFrame(() => {
      if (area.current) area.current.style.height = "auto";
    });
  };

  return (
    <div className="shrink-0 border-t border-mist/60 p-2.5">
      {files.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <span
              key={`${f.name}-${i}`}
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-fog py-1 pl-2 pr-1 text-[11px] text-ink"
            >
              <Paperclip className="h-3 w-3 shrink-0 text-steel" />
              <span className="truncate">{f.name}</span>
              <span className="shrink-0 font-mono text-[10px] text-steel">{formatBytes(f.size)}</span>
              <button
                type="button"
                onClick={() => onRemoveFile(i)}
                aria-label={`Remove ${f.name}`}
                className="grid h-5 w-5 place-items-center rounded-md text-steel hover:bg-paper hover:text-ink"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="rounded-xl border border-mist/80 px-2.5 py-1.5 focus-within:border-ink/40">
        <textarea
          ref={area}
          value={input}
          onChange={(e) => {
            onInput(e.target.value);
            autosize();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={readOnly ? "Ask about money — this view can't create drafts…" : "Ask about money, or dictate a payment…"}
          aria-label="Message the agent"
          disabled={disabled}
          className="max-h-[120px] w-full resize-none bg-transparent text-[12px] leading-5 text-ink outline-none placeholder:text-steel disabled:opacity-50"
        />
        <div className="flex items-center gap-1 pt-1">
          <button
            type="button"
            onClick={() => picker.current?.click()}
            aria-label="Add attachment"
            disabled={disabled || files.length >= 5}
            className="grid h-7 w-7 place-items-center rounded-lg text-steel transition-colors hover:bg-fog hover:text-ink disabled:opacity-40"
          >
            <Paperclip className="h-3.5 w-3.5" />
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              onFiles([...e.target.files]);
              e.target.value = "";
            }}
          />
          <span className="text-[10px] text-steel">
            {readOnly ? "read-only" : files.length > 0 ? `${files.length}/5 files` : "PDF · text · audio · images"}
          </span>
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop"
              className="ml-auto grid h-7 w-7 place-items-center rounded-lg bg-ink text-paper"
            >
              <Square className="h-3 w-3 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              onClick={submit}
              disabled={(!input.trim() && files.length === 0) || disabled}
              aria-label="Send"
              className={cn(
                "ml-auto grid h-7 w-7 place-items-center rounded-lg bg-ink text-paper disabled:opacity-30",
              )}
            >
              <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
      <p className="mt-1.5 flex items-center gap-1 px-0.5 text-[9.5px] leading-4 text-steel">
        <Lock className="h-2.5 w-2.5" /> {readOnly ? "Read-only here — drafts disabled on this screen." : "Money moves only from an approval card."}
      </p>
    </div>
  );
}
