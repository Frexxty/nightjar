// The renderer's markdown reader is TypeScript; Node 22.6+ strips the types
// itself, so the test imports the source directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInline, parseMarkdown } from "../src/lib/markdown.ts";

test("parseMarkdown handles headings, lists, paragraphs and code", () => {
  const blocks = parseMarkdown("## New\n\n- one\n- two `x`\n\nSome text\nwrapped.\n\n```\ncode\n```\n1. first");
  assert.deepEqual(blocks.map((b) => b.kind), ["heading", "list", "paragraph", "code", "list"]);
  assert.equal(blocks[0].level, 2);
  assert.equal(blocks[1].items.length, 2);
  assert.deepEqual(blocks[1].items[1][1], { kind: "code", text: "x" });
  assert.deepEqual(blocks[2].inlines, [{ kind: "text", text: "Some text wrapped." }]);
  assert.equal(blocks[3].text, "code");
  assert.equal(blocks[4].ordered, true);
});

test("parseInline only links http(s) URLs", () => {
  assert.deepEqual(parseInline("[ok](https://example.com/a)"), [{ kind: "link", text: "ok", href: "https://example.com/a" }]);
  assert.deepEqual(parseInline("[bad](javascript:alert(1))")[0].kind, "text");
  assert.deepEqual(parseInline("**b** and *i*").map((p) => p.kind), ["strong", "text", "em"]);
  // Raw HTML stays text; the template interpolates it, so it never becomes markup.
  assert.deepEqual(parseInline("<img src=x onerror=alert(1)>"), [{ kind: "text", text: "<img src=x onerror=alert(1)>" }]);
});
