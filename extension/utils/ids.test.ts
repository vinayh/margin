import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { cleanDocTitleFallback, parseDocIdFromUrl } from "./ids.ts";

describe("parseDocIdFromUrl", () => {
  test("extracts the id from a canonical /document/d/<id>/edit url", () => {
    assert.equal(
      parseDocIdFromUrl(
        "https://docs.google.com/document/d/1aB-cD_0123456789zZyXwVu/edit",
      ),
      "1aB-cD_0123456789zZyXwVu",
    );
  });

  test("works on the /document/d/<id>/edit?usp=… variant", () => {
    assert.equal(
      parseDocIdFromUrl(
        "https://docs.google.com/document/d/abc_DEF-ghi-1234567890XY/edit?usp=sharing",
      ),
      "abc_DEF-ghi-1234567890XY",
    );
  });

  test("returns null when there is no /document/d/<id> segment", () => {
    assert.equal(parseDocIdFromUrl("https://example.com/foo/bar"), null);
  });

  test("returns null when the id is too short", () => {
    assert.equal(parseDocIdFromUrl("https://docs.google.com/document/d/short/edit"), null);
  });
});

describe("cleanDocTitleFallback", () => {
  test('strips a trailing " - Google Docs" suffix', () => {
    assert.equal(cleanDocTitleFallback("My Doc - Google Docs"), "My Doc");
  });

  test("strips localized variants — the brand 'Google' is the anchor", () => {
    assert.equal(cleanDocTitleFallback("Mon Doc - Documents Google"), "Mon Doc");
    assert.equal(cleanDocTitleFallback("Mi Doc - Documentos de Google"), "Mi Doc");
    assert.equal(cleanDocTitleFallback("Mein Doc - Google Dokumente"), "Mein Doc");
    assert.equal(
      cleanDocTitleFallback("私のドキュメント - Google ドキュメント"),
      "私のドキュメント",
    );
    assert.equal(cleanDocTitleFallback("我的文件 - Google 文档"), "我的文件");
    assert.equal(cleanDocTitleFallback("Мой документ - Google Документы"), "Мой документ");
  });

  test("strips only the Docs suffix, preserving in-name dashes", () => {
    assert.equal(cleanDocTitleFallback("Foo - Bar - Google Docs"), "Foo - Bar");
  });

  test("leaves a user title with a dash but no Docs suffix untouched", () => {
    assert.equal(cleanDocTitleFallback("Foo - Bar"), "Foo - Bar");
    assert.equal(cleanDocTitleFallback("Q4 plan - draft"), "Q4 plan - draft");
  });

  test("returns the original when there is no ' - ' separator", () => {
    assert.equal(cleanDocTitleFallback("Untitled document"), "Untitled document");
  });

  test("falls back to the original when stripping would leave an empty name", () => {
    assert.equal(cleanDocTitleFallback(" - Google Docs"), "- Google Docs");
  });

  test("empty / null / undefined → empty string", () => {
    assert.equal(cleanDocTitleFallback(""), "");
    assert.equal(cleanDocTitleFallback(null), "");
    assert.equal(cleanDocTitleFallback(undefined), "");
  });
});
