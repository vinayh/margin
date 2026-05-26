import "../../test/setup.ts";
import { describe, it as test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { inlineJson } from "./render.ts";

const U2028 = String.fromCodePoint(0x2028);
const U2029 = String.fromCodePoint(0x2029);

describe("inlineJson", () => {
  test("produces a valid JSON literal for ordinary strings", () => {
    expect(inlineJson("hello")).toBe(`"hello"`);
    expect(inlineJson({ a: 1 })).toBe(`{"a":1}`);
  });

  test("escapes </script> so embedded content can't break the tag", () => {
    const out = inlineJson("x</script><script>alert(1)</script>");
    expect(out.includes("</script")).toBe(false);
    expect(out.includes("<\\/script")).toBe(true);
  });

  test("handles uppercase / mixed-case </SCRIPT> too", () => {
    const out = inlineJson("a</ScRiPt>b");
    expect(/<\/script/i.test(out)).toBe(false);
  });

  test("escapes <!-- so the value can't open an HTML comment", () => {
    const out = inlineJson("oops <!-- nope");
    expect(out.includes("<!--")).toBe(false);
    expect(out.includes("<\\!--")).toBe(true);
  });

  test("escapes U+2028 / U+2029 line separators", () => {
    const input = `a${U2028}b${U2029}c`;
    const out = inlineJson(input);
    expect(out.includes(U2028)).toBe(false);
    expect(out.includes(U2029)).toBe(false);
    expect(out.includes("\\u2028")).toBe(true);
    expect(out.includes("\\u2029")).toBe(true);
  });

  test("the output evaluates as JS to the original value", () => {
    // We escape sequences (e.g. `<!--`) that the browser interprets inside
    // a script tag but JSON.parse does not accept. Round-trip through
    // Function() to reflect how the value is actually consumed.
    const inputs: unknown[] = [
      "x</script>y",
      "<!--",
      `line1${U2028}line2`,
      { nested: "</script><!--" },
      ["</script>", "<!--", U2029],
    ];
    for (const input of inputs) {
      const evaluated = new Function(`return ${inlineJson(input)};`)();
      expect(evaluated).toEqual(input);
    }
  });
});
