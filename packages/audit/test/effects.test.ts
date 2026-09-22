import assert from "node:assert/strict";
import { test } from "node:test";

import { effectBadges, isEffectLabel, EFFECT_LABELS } from "../src/index.js";

test("maps every effect label to its badge and color intent", () => {
  assert.deepEqual(effectBadges(["none"]), [
    { label: "none", badge: "PURE", color: "green" },
  ]);
  assert.deepEqual(effectBadges(["mut"]), [
    { label: "mut", badge: "MUTATES_STATE", color: "amber" },
  ]);
  assert.deepEqual(effectBadges(["io"]), [
    { label: "io", badge: "IO", color: "blue" },
  ]);
  assert.deepEqual(effectBadges(["chan"]), [
    { label: "chan", badge: "CONCURRENCY", color: "purple" },
  ]);
  assert.deepEqual(effectBadges(["extern"]), [
    { label: "extern", badge: "EXTERNAL_FFI", color: "red" },
  ]);
});

test("renders multiple effects in the canonical label order", () => {
  assert.deepEqual(
    effectBadges(["extern", "io", "mut"]).map((view) => view.badge),
    ["MUTATES_STATE", "IO", "EXTERNAL_FFI"],
  );
});

test("drops duplicate labels", () => {
  assert.deepEqual(
    effectBadges(["io", "io"]).map((view) => view.badge),
    ["IO"],
  );
});

test("returns no badges for an empty profile", () => {
  assert.deepEqual(effectBadges([]), []);
});

test("recognizes only the five Xz effect labels", () => {
  assert.equal(EFFECT_LABELS.length, 5);
  assert.equal(isEffectLabel("io"), true);
  assert.equal(isEffectLabel("network"), false);
});
