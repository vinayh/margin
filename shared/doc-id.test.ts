import "../backend/test/setup.ts";
import { describe, it as test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  cleanDocTitleFallback,
  googleDocUrl,
  parseDocIdFromUrl,
  parseGoogleDocId,
} from "./doc-id.ts";

describe("parseGoogleDocId", () => {
  test("extracts id from a standard edit URL", () => {
    expect(
      parseGoogleDocId("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUv/edit"),
    ).toBe("1AbCdEfGhIjKlMnOpQrStUv");
  });

  test("extracts id from a URL with query and fragment", () => {
    expect(
      parseGoogleDocId(
        "https://docs.google.com/document/d/abcDEF123_-456789012345/edit?tab=t.0&usp=sharing#heading",
      ),
    ).toBe("abcDEF123_-456789012345");
  });

  test("extracts id from a URL ending at /edit", () => {
    expect(
      parseGoogleDocId("https://docs.google.com/document/d/abcDEF123_-456789012345"),
    ).toBe("abcDEF123_-456789012345");
  });

  test("accepts a bare id", () => {
    expect(parseGoogleDocId("1AbCdEfGhIjKlMnOpQrStUvWxYz")).toBe(
      "1AbCdEfGhIjKlMnOpQrStUvWxYz",
    );
  });

  test("trims surrounding whitespace", () => {
    expect(
      parseGoogleDocId("  https://docs.google.com/document/d/abcDEF123_-456789012345/edit  "),
    ).toBe("abcDEF123_-456789012345");
  });

  test("rejects a non-doc URL", () => {
    expect(() => parseGoogleDocId("https://drive.google.com/file/d/abc/view")).toThrow(
      /unrecognized/,
    );
  });

  test("rejects a short string that doesn't look like an id", () => {
    expect(() => parseGoogleDocId("hello")).toThrow(/unrecognized/);
  });
});

describe("parseDocIdFromUrl", () => {
  test("returns the id from a docs URL", () => {
    expect(
      parseDocIdFromUrl(
        "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUv/edit",
      ),
    ).toBe("1AbCdEfGhIjKlMnOpQrStUv");
  });

  test("returns null for non-doc URLs", () => {
    expect(parseDocIdFromUrl("https://example.com/foo")).toBeNull();
  });

  test("returns null for too-short id", () => {
    expect(
      parseDocIdFromUrl("https://docs.google.com/document/d/short/edit"),
    ).toBeNull();
  });
});

describe("googleDocUrl", () => {
  test("builds a docs URL from an id", () => {
    expect(googleDocUrl("abc123")).toBe("https://docs.google.com/document/d/abc123/edit");
  });
});

describe("cleanDocTitleFallback", () => {
  test("strips the Docs suffix in english", () => {
    expect(cleanDocTitleFallback("My Doc - Google Docs")).toBe("My Doc");
  });

  test("strips localized Docs suffixes (Google noun stays)", () => {
    expect(cleanDocTitleFallback("Mon Doc - Documents Google")).toBe("Mon Doc");
    expect(cleanDocTitleFallback("Mi Doc - Documentos de Google")).toBe("Mi Doc");
    expect(cleanDocTitleFallback("Mein Doc - Google Dokumente")).toBe("Mein Doc");
  });

  test("only strips the last suffix when it contains Google", () => {
    expect(cleanDocTitleFallback("Foo - Bar - Google Docs")).toBe("Foo - Bar");
    expect(cleanDocTitleFallback("Foo - Bar")).toBe("Foo - Bar");
  });

  test("empty / nullish input → empty string", () => {
    expect(cleanDocTitleFallback("")).toBe("");
    expect(cleanDocTitleFallback(null)).toBe("");
    expect(cleanDocTitleFallback(undefined)).toBe("");
  });
});
