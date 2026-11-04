import { Paperclip } from "lucide-react";
import AgentTurn from "@/components/arkay/ai/AgentTurn";
import { formatBytes } from "@/components/arkay/ai/Composer";

export default function AgentMessage({ message }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%]">
          {(message.attachments ?? []).length > 0 ? (
            <div className="mb-1 flex flex-wrap justify-end gap-1">
              {(message.attachments ?? []).map((a, i) => (
                <span
                  key={`${a.name}-${i}`}
                  className="inline-flex items-center gap-1 rounded-md bg-fog px-1.5 py-0.5 text-[10px] text-graphite"
                >
                  <Paperclip className="h-2.5 w-2.5 text-steel" />
                  {a.name} · {formatBytes(a.size)}
                </span>
              ))}
            </div>
          ) : null}
          <p className="whitespace-pre-wrap rounded-xl rounded-br-sm bg-ink px-3 py-2 text-[12px] leading-5 text-paper">
            {message.text}
          </p>
        </div>
      </div>
    );
  }

  return <AgentTurn turn={message} />;
}
