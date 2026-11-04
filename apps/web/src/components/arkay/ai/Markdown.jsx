/** Dependency-free safe markdown for agent text: paragraphs, bold, code, lists. */

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderInline(s) {
  // `code` first so stars inside code aren't bolded.
  const codes = [];
  let out = escapeHtml(s).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `\uE000${codes.length - 1}\uE001`;
  });
  out = out
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/\uE000(\d+)\uE001/g, (_, i) => `<code class="md-code">${codes[Number(i)]}</code>`);
  return out;
}

export function markdownToHtml(text) {
  const lines = String(text ?? "").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = null; // { ordered: bool, items: [] }

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      const tag = list.ordered ? "ol" : "ul";
      blocks.push(
        `<${tag}>${list.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`,
      );
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const ul = /^[*-]\s+(.+)/.exec(line);
    const ol = /^\d+[.)]\s+(.+)/.exec(line);
    const quote = /^&gt; |^>\s?/.test(escapeHtml(line)) ? line.replace(/^>\s?/, "") : null;
    if (ul || ol) {
      flushParagraph();
      const ordered = Boolean(ol);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(ul ? ul[1] : ol[1]);
    } else if (quote !== null && line.startsWith(">")) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote>${renderInline(quote)}</blockquote>`);
    } else if (!line.trim()) {
      flushParagraph();
      flushList();
    } else {
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return blocks.join("");
}

export default function Markdown({ text, className = "" }) {
  return (
    <div
      className={`md-prose text-[12px] leading-5 text-ink ${className}`}
      dangerouslySetInnerHTML={{ __html: markdownToHtml(text) }}
    />
  );
}
