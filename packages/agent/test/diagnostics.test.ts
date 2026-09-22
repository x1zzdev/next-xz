import assert from "node:assert/strict";
import { test } from "node:test";

import { DiagnosticParseError, parseDiagnostics } from "../src/index.js";

const I0022 =
  '[{"version":1,"severity":"error","code":"I0022","message":"missing intent comment on public function \'f\'","category":"intent","span":{"file":"bad3.xz","start":[1,6],"end":[1,7]}}]';

const WITH_SUGGESTION =
  '[{"version":1,"severity":"error","code":"I0020","message":"declared @effects \'none\' does not match derived effects \'io\' on \'f\'","category":"intent","span":{"file":"src/main.xz","start":[4,6],"end":[4,7]},"suggestion":{"fix":"extend @effects on \'f\' to include \'io\'","confidence":0.9}}]';

test("parses an empty diagnostic array", () => {
  assert.deepEqual(parseDiagnostics("[]"), []);
});

test("parses a real xz check-json diagnostic without a suggestion", () => {
  const [diagnostic] = parseDiagnostics(I0022);
  assert.equal(diagnostic?.version, 1);
  assert.equal(diagnostic?.severity, "error");
  assert.equal(diagnostic?.code, "I0022");
  assert.equal(diagnostic?.category, "intent");
  assert.equal(diagnostic?.span.file, "bad3.xz");
  assert.deepEqual(diagnostic?.span.start, [1, 6]);
  assert.deepEqual(diagnostic?.span.end, [1, 7]);
  assert.equal(diagnostic?.suggestion, undefined);
});

test("parses a suggestion with a confidence score", () => {
  const [diagnostic] = parseDiagnostics(WITH_SUGGESTION);
  assert.equal(diagnostic?.suggestion?.fix, "extend @effects on 'f' to include 'io'");
  assert.equal(diagnostic?.suggestion?.confidence, 0.9);
});

test("rejects output that is not JSON", () => {
  assert.throws(
    () => parseDiagnostics("error: unexpected character @ at bad.xz:1:1"),
    DiagnosticParseError,
  );
});

test("rejects a JSON object that is not an array", () => {
  assert.throws(() => parseDiagnostics("{}"), DiagnosticParseError);
});

test("rejects an unknown category", () => {
  const malformed = '[{"version":1,"severity":"error","code":"X","message":"m","category":"bogus","span":{"file":"a.xz","start":[1,1],"end":[1,1]}}]';
  assert.throws(
    () => parseDiagnostics(malformed),
    (error: unknown) => error instanceof DiagnosticParseError && /category/.test(error.message),
  );
});

test("rejects a malformed span position", () => {
  const malformed = '[{"version":1,"severity":"error","code":"X","message":"m","category":"type","span":{"file":"a.xz","start":[1],"end":[1,1]}}]';
  assert.throws(
    () => parseDiagnostics(malformed),
    (error: unknown) => error instanceof DiagnosticParseError && /\[line, column\]/.test(error.message),
  );
});