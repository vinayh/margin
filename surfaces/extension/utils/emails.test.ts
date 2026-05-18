import { expect, test } from "bun:test";
import { isValidEmail, parseEmails, validateEmails } from "./emails.ts";

test("parseEmails splits on commas, semicolons, newlines, whitespace", () => {
  expect(parseEmails("a@x.com, b@x.com")).toEqual(["a@x.com", "b@x.com"]);
  expect(parseEmails("a@x.com;b@x.com\nc@x.com")).toEqual([
    "a@x.com",
    "b@x.com",
    "c@x.com",
  ]);
  expect(parseEmails("  ")).toEqual([]);
});

test("isValidEmail rejects obvious typos", () => {
  expect(isValidEmail("alice@example.com")).toBe(true);
  expect(isValidEmail("alice+tag@x.co.uk")).toBe(true);
  expect(isValidEmail("alice@")).toBe(false);
  expect(isValidEmail("alice")).toBe(false);
  expect(isValidEmail("alice@example")).toBe(false);
  expect(isValidEmail("@example.com")).toBe(false);
  expect(isValidEmail("a @example.com")).toBe(false);
});

test("validateEmails partitions valid vs invalid", () => {
  const r = validateEmails("alice@x.com, bob@, charlie@y.io");
  expect(r.valid).toEqual(["alice@x.com", "charlie@y.io"]);
  expect(r.invalid).toEqual(["bob@"]);
});
