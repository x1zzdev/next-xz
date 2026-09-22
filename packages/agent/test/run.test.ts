import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AgentScopeError,
  DEFAULT_RETRIES,
  runAgent,
  type CheckProcessResult,
  type Diagnostic,
  type ProcessRunner,
  type Prompt,
} from "../src/index.js";

const EMPTY = "[]";

function diagnosticJson(code: string, category: Diagnostic["category"], confidence?: number): string {
  const entry = {
    version: 1,
    severity: "error",
    code,
    message: `${code} message`,
    category,
    span: { file: "order.xz", start: [1, 1], end: [1, 2] },
    ...(confidence === undefined ? {} : { suggestion: { fix: `fix ${code}`, confidence } }),
  };
  return JSON.stringify([entry]);
}

function queuedRunner(outputs: readonly CheckProcessResult[]): {
  runner: ProcessRunner;
  calls: number[];
} {
  const calls: number[] = [];
  return {
    calls,
    runner: () => {
      const index = calls.length;
      const output = outputs[Math.min(index, outputs.length - 1)];
      calls.push(index);
      return Promise.resolve(output ?? { stdout: EMPTY, stderr: "", exitCode: 0 });
    },
  };
}

function failing(stdout: string): CheckProcessResult {
  return { stdout, stderr: "", exitCode: 1 };
}

function passing(): CheckProcessResult {
  return { stdout: EMPTY, stderr: "", exitCode: 0 };
}

function recorder(sources: readonly string[]): {
  generate: (prompt: Prompt) => Promise<string>;
  prompts: Prompt[];
} {
  const prompts: Prompt[] = [];
  return {
    prompts,
    generate: (prompt) => {
      const source = sources[Math.min(prompts.length, sources.length - 1)] ?? "";
      prompts.push(prompt);
      return Promise.resolve(source);
    },
  };
}

test("passes on the first attempt without a repair prompt", async () => {
  const { runner, calls } = queuedRunner([passing()]);
  const { generate, prompts } = recorder(["func f() {}"]);
  const writes: Array<{ path: string; contents: string }> = [];

  const result = await runAgent({
    intent: "x",
    target: "order.xz",
    generate,
    runner,
    writeFile: (path, contents) => {
      writes.push({ path, contents });
      return Promise.resolve();
    },
  });

  assert.equal(result.status, "passed");
  assert.equal(result.attempts, 1);
  assert.deepEqual(result.history.map((entry) => entry.attempt), [1]);
  assert.equal(prompts.length, 1);
  assert.doesNotMatch(prompts[0]?.user ?? "", /Repair:/);
  assert.deepEqual(writes, [{ path: "order.xz", contents: "func f() {}" }]);
  assert.equal(calls.length, 1);
});

test("self-corrects on the second attempt using ranked diagnostics", async () => {
  const { runner, calls } = queuedRunner([failing(diagnosticJson("I0020", "intent", 0.9)), passing()]);
  const { generate, prompts } = recorder(["broken", "fixed"]);

  const result = await runAgent({
    intent: "x",
    target: "order.xz",
    generate,
    runner,
    writeFile: () => Promise.resolve(),
  });

  assert.equal(result.status, "passed");
  assert.equal(result.attempts, 2);
  assert.equal(calls.length, 2);
  assert.equal(result.source, "fixed");
  assert.equal(result.history.length, 2);
  assert.match(prompts[1]?.user ?? "", /Repair:/);
  assert.match(prompts[1]?.user ?? "", /I0020/);
  assert.match(prompts[1]?.user ?? "", /Previous candidate:\nbroken/);
});

test("escalates after the retry budget is exhausted", async () => {
  const { runner, calls } = queuedRunner([failing(diagnosticJson("P0001", "parse"))]);
  const { generate } = recorder(["attempt"]);

  const result = await runAgent({
    intent: "x",
    target: "order.xz",
    generate,
    runner,
    writeFile: () => Promise.resolve(),
  });

  assert.equal(result.status, "escalated");
  assert.equal(result.attempts, DEFAULT_RETRIES);
  assert.equal(calls.length, DEFAULT_RETRIES);
  assert.equal(result.diagnostics[0]?.code, "P0001");
  assert.equal(result.history.length, DEFAULT_RETRIES);
});

test("honors a custom retry budget", async () => {
  const { runner, calls } = queuedRunner([failing(diagnosticJson("P0001", "parse"))]);
  const result = await runAgent({
    intent: "x",
    target: "order.xz",
    generate: () => Promise.resolve("attempt"),
    runner,
    retries: 2,
    writeFile: () => Promise.resolve(),
  });
  assert.equal(result.attempts, 2);
  assert.equal(calls.length, 2);
  assert.equal(result.history.length, 2);
});

test("records a stable prompt hash per attempt", async () => {
  const { runner } = queuedRunner([passing()]);
  const seen: string[] = [];
  await runAgent({
    intent: "x",
    target: "order.xz",
    generate: () => Promise.resolve("func f() {}"),
    runner,
    writeFile: () => Promise.resolve(),
    onAttempt: (attempt) => {
      seen.push(attempt.promptHash);
    },
  });
  assert.equal(seen.length, 1);
  assert.match(seen[0] ?? "", /^[0-9a-f]{64}$/);
});

test("refuses to write outside the .xz/.xzint scope", async () => {
  await assert.rejects(
    runAgent({
      intent: "x",
      target: "app/page.tsx",
      generate: () => Promise.resolve(""),
      writeFile: () => Promise.resolve(),
    }),
    (error: unknown) => error instanceof AgentScopeError && error.target === "app/page.tsx",
  );
});

test("allows a wider scope when the developer flag is set", async () => {
  const { runner } = queuedRunner([passing()]);
  const result = await runAgent({
    intent: "x",
    target: "app/page.tsx",
    generate: () => Promise.resolve("content"),
    runner,
    writeFile: () => Promise.resolve(),
    allowAppEdits: true,
  });
  assert.equal(result.status, "passed");
});

test("rejects a non-positive retry budget", async () => {
  await assert.rejects(
    runAgent({
      intent: "x",
      target: "order.xz",
      generate: () => Promise.resolve(""),
      retries: 0,
      writeFile: () => Promise.resolve(),
    }),
    RangeError,
  );
});