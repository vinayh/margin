import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { ParagraphSummary } from "../../../utils/types.ts";
import { alignParagraphs } from "./align.ts";

function para(
  text: string,
  opts?: { heading?: string; runs?: { content: string; style?: object }[] },
): ParagraphSummary {
  const runs = opts?.runs ?? [{ content: text }];
  return {
    plaintext: text,
    namedStyleType: opts?.heading ?? null,
    runs: runs.map((r) => ({
      content: r.content,
      style: (r.style as ParagraphSummary["runs"][number]["style"]) ?? null,
    })),
  };
}

describe("alignParagraphs", () => {
  test("identical sequences → all matches", () => {
    const a = [para("one"), para("two"), para("three")];
    const b = [para("one"), para("two"), para("three")];
    const rows = alignParagraphs(a, b);
    assert.deepEqual(rows.map((r) => r.kind), ["match", "match", "match"]);
  });

  test("pure insert at the end", () => {
    const a = [para("one")];
    const b = [para("one"), para("two")];
    const rows = alignParagraphs(a, b);
    assert.deepEqual(rows.map((r) => r.kind), ["match", "added"]);
  });

  test("pure delete at the start", () => {
    const a = [para("one"), para("two")];
    const b = [para("two")];
    const rows = alignParagraphs(a, b);
    assert.deepEqual(rows.map((r) => r.kind), ["removed", "match"]);
  });

  test("adjacent delete+insert of same length → modified rows with word diff", () => {
    const a = [para("hello world")];
    const b = [para("hello there")];
    const rows = alignParagraphs(a, b);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.kind, "modified");
    if (rows[0]!.kind === "modified") {
      assert.equal(rows[0]!.words.some((w) => w.added), true);
      assert.equal(rows[0]!.words.some((w) => w.removed), true);
    }
  });

  test("style-only change: same plaintext + heading, different runs → style-changed", () => {
    const a = [para("title", { runs: [{ content: "title" }] })];
    const b = [
      para("title", { runs: [{ content: "title", style: { bold: true } }] }),
    ];
    const rows = alignParagraphs(a, b);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.kind, "style-changed");
  });

  test("heading-level change breaks alignment (delete + insert, not match)", () => {
    const a = [para("intro", { heading: "HEADING_1" })];
    const b = [para("intro", { heading: "HEADING_2" })];
    const rows = alignParagraphs(a, b);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.kind, "modified");
  });

  test("mismatched lengths in removed+added blocks: extras emit as add/remove", () => {
    const a = [para("a-old"), para("b-old")];
    const b = [para("a-new")];
    const rows = alignParagraphs(a, b);
    assert.deepEqual(rows.map((r) => r.kind), ["modified", "removed"]);
  });
});
