import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidEmail, parseEmails, validateEmails } from "./emails.ts";

test("parseEmails splits on commas, semicolons, newlines, whitespace", () => {
  assert.deepEqual(parseEmails("a@x.com, b@x.com"), ["a@x.com", "b@x.com"]);
  assert.deepEqual(parseEmails("a@x.com;b@x.com\nc@x.com"), [
    "a@x.com",
    "b@x.com",
    "c@x.com",
  ]);
  assert.deepEqual(parseEmails("  "), []);
});

test("isValidEmail rejects obvious typos", () => {
  assert.equal(isValidEmail("alice@example.com"), true);
  assert.equal(isValidEmail("alice+tag@x.co.uk"), true);
  assert.equal(isValidEmail("alice@"), false);
  assert.equal(isValidEmail("alice"), false);
  assert.equal(isValidEmail("alice@example"), false);
  assert.equal(isValidEmail("@example.com"), false);
  assert.equal(isValidEmail("a @example.com"), false);
});

test("validateEmails partitions valid vs invalid", () => {
  const r = validateEmails("alice@x.com, bob@, charlie@y.io");
  assert.deepEqual(r.valid, ["alice@x.com", "charlie@y.io"]);
  assert.deepEqual(r.invalid, ["bob@"]);
});
