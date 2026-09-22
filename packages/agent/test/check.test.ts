import assert from "node:assert/strict";
import { test } from "node:test";

import {
  XzCheckError,
  resolveExecutable,
  runCheckJson,
  type ProcessRunner,
} from "../src/index.js";

interface Captured {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
}

function fakeRunner(stdout: string, exitCode: number, stderr = ""): {
  runner: ProcessRunner;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  return {
    calls,
    runner: (command, args, options) => {
      calls.push({ command, args, ...(options.cwd === undefined ? {} : { cwd: options.cwd }) });
      return Promise.resolve({ stdout, stderr, exitCode });
    },
  };
}

test("invokes xz check-json for the target file", async () => {
  const { runner, calls } = fakeRunner("[]", 0);
  const result = await runCheckJson({ file: "src/logic/order.xz", runner });
  assert.deepEqual(calls, [{ command: "xz", args: ["check-json", "src/logic/order.xz"] }]);
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.diagnostics, []);
});

test("passes --strict and a custom executable", async () => {
  const { runner, calls } = fakeRunner("[]", 0);
  await runCheckJson({
    file: "order.xz",
    strict: true,
    executable: "~/Xz/xz-cli/target/release/xz",
    cwd: "/repo",
    runner,
  });
  assert.deepEqual(calls, [
    {
      command: "~/Xz/xz-cli/target/release/xz",
      args: ["check-json", "--strict", "order.xz"],
      cwd: "/repo",
    },
  ]);
});

test("surfaces compiler diagnostics with ok=false", async () => {
  const diagnostic =
    '[{"version":1,"severity":"error","code":"P0001","message":"expected identifier","category":"parse","span":{"file":"order.xz","start":[1,10],"end":[1,10]}}]';
  const { runner } = fakeRunner(diagnostic, 1);
  const result = await runCheckJson({ file: "order.xz", runner });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.diagnostics[0]?.code, "P0001");
});

test("raises XzCheckError when check-json does not emit a diagnostic array", async () => {
  const { runner } = fakeRunner("error: unexpected character @ at bad.xz:1:1", 1, "boom");
  await assert.rejects(
    runCheckJson({ file: "bad.xz", runner }),
    (error: unknown) =>
      error instanceof XzCheckError &&
      error.file === "bad.xz" &&
      error.exitCode === 1 &&
      error.stderr === "boom",
  );
});

test("resolveExecutable prefers the explicit path, then XZ_CLI, then xz", () => {
  const previous = process.env["XZ_CLI"];
  try {
    delete process.env["XZ_CLI"];
    assert.equal(resolveExecutable(), "xz");
    process.env["XZ_CLI"] = "/opt/xz/bin/xz";
    assert.equal(resolveExecutable(), "/opt/xz/bin/xz");
    assert.equal(resolveExecutable("/usr/local/bin/xz"), "/usr/local/bin/xz");
  } finally {
    if (previous === undefined) {
      delete process.env["XZ_CLI"];
    } else {
      process.env["XZ_CLI"] = previous;
    }
  }
});