import assert from "node:assert/strict";
import { test } from "node:test";

import {
  XzContractError,
  runContracted,
  type ContractDescriptor,
} from "../src/index.js";

const descriptor: ContractDescriptor = {
  library: "liborder",
  symbol: "parse_amount",
  okCode: 0,
  errorNames: { 1: "InvalidAmount", 2: "Overflow" },
};

test("returns the out value when the status is the ok code", () => {
  const value = runContracted(descriptor, () => 0, () => 42);
  assert.equal(value, 42);
});

test("throws a typed error carrying library, symbol, and code", () => {
  assert.throws(
    () => runContracted(descriptor, () => 2, () => 0),
    (error: unknown) =>
      error instanceof XzContractError &&
      error.library === "liborder" &&
      error.symbol === "parse_amount" &&
      error.code === 2 &&
      error.errorName === "Overflow" &&
      error.message.includes("status 2 (Overflow)"),
  );
});

test("does not read the out value when the status is an error", () => {
  let read = false;
  assert.throws(
    () =>
      runContracted(descriptor, () => 1, () => {
        read = true;
        return 0;
      }),
    XzContractError,
  );
  assert.equal(read, false);
});

test("throws with the numeric code when no error name is declared", () => {
  assert.throws(
    () => runContracted(descriptor, () => 99, () => 0),
    (error: unknown) =>
      error instanceof XzContractError &&
      error.code === 99 &&
      error.errorName === undefined,
  );
});