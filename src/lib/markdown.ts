// A small markdown reader for release notes. It returns plain data that the
// template renders with text interpolation, so nothing from GitHub ever goes
// through v-html. Covers headings, lists, paragraphs, fenced code, inline
// code, bold, italic and links, which is all our release notes use.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: number; inlines: Inline[] }
  | { kind: "paragraph"; inlines: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "code"; text: string };

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s<>()]+)/g;

export function safeHref(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of source.matchAll(INLINE)) {
    const index = m.index ?? 0;
    if (index > last) out.push({ kind: "text", text: source.slice(last, index) });
    const token = m[0];
    if (m[1]) out.push({ kind: "code", text: token.slice(1, -1) });
    else if (m[2]) out.push({ kind: "strong", text: token.slice(2, -2) });
    else if (m[3]) out.push({ kind: "em", text: token.slice(1, -1) });
    else if (m[4]) {
      const [, text, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token) ?? [];
      const safe = safeHref(href ?? "");
      out.push(safe ? { kind: "link", text: text ?? safe, href: safe } : { kind: "text", text: text ?? token });
    } else {
      const safe = safeHref(token);
      out.push(safe ? { kind: "link", text: token, href: safe } : { kind: "text", text: token });
    }
    last = index + token.length;
  }
  if (last < source.length) out.push({ kind: "text", text: source.slice(last) });
  return out;
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", inlines: parseInline(paragraph.join(" ")) });
    if (list) blocks.push({ kind: "list", ordered: list.ordered, items: list.items.map(parseInline) });
    paragraph = [];
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length, inlines: parseInline(heading[2]) });
      continue;
    }
    const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      const ordered = /\d/.test(item[1]);
      if (paragraph.length || (list && list.ordered !== ordered)) flush();
      list ??= { ordered, items: [] };
      list.items.push(item[2]);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    // An indented line right after a list item continues that item.
    if (list && /^\s+/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    if (list) flush();
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}
