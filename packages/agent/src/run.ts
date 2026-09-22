import { createHash } from "node:crypto";
import { mkdir, writeFile as fsWriteFile } from "node:fs/promises";
import { dirname } from "node:path";

import { runCheckJson, type ProcessRunner } from "./check.js";
import type { Diagnostic } from "./diagnostics.js";
import { AgentScopeError } from "./errors.js";
import { computeRunMetrics, type RunMetrics } from "./metrics.js";
import { buildPrompt, extractCandidate, type GenerateText, type Prompt } from "./prompt.js";
import { rankDiagnostics } from "./ranking.js";

export const DEFAULT_RETRIES = 3;

const WRITABLE_SUFFIXES = [".xz", ".xzint"] as const;

export type AgentStatus = "passed" | "escalated";

export interface AgentAttempt {
  readonly attempt: number;
  readonly promptHash: string;
  readonly source: string;
  readonly diagnostics: readonly Diagnostic[];
}

export type FileWriter = (path: string, contents: string) => Promise<void>;

export interface RunAgentOptions {
  readonly intent: string;
  readonly target: string;
  readonly generate: GenerateText;
  readonly shell?: string;
  readonly retries?: number;
  readonly strict?: boolean;
  readonly executable?: string;
  readonly cwd?: string;
  readonly runner?: ProcessRunner;
  readonly writeFile?: FileWriter;
  readonly allowAppEdits?: boolean;
  readonly onAttempt?: (attempt: AgentAttempt) => void;
}

export interface RunAgentResult {
  readonly status: AgentStatus;
  readonly target: string;
  readonly attempts: number;
  readonly source: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly history: readonly AgentAttempt[];
  readonly metrics: RunMetrics;
}

export function isWritableTarget(target: string): boolean {
  return WRITABLE_SUFFIXES.some((suffix) => target.endsWith(suffix));
}

export function hashPrompt(prompt: Prompt): string {
  return createHash("sha256")
    .update(prompt.system)
    .update("\u0000")
    .update(prompt.user)
    .digest("hex");
}

export async function runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  if (!Number.isInteger(retries) || retries < 1) {
    throw new RangeError(`retries must be a positive integer, got ${retries}`);
  }
  if (options.allowAppEdits !== true && !isWritableTarget(options.target)) {
    throw new AgentScopeError(options.target);
  }

  const write = options.writeFile ?? defaultWriteFile;
  const history: AgentAttempt[] = [];
  let source = "";
  let priorSource: string | undefined;
  let diagnostics: readonly Diagnostic[] = [];

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const prompt = buildPrompt({
      intent: options.intent,
      target: options.target,
      attempt,
      retries,
      ...(options.shell === undefined ? {} : { shell: options.shell }),
      ...(attempt > 1 && diagnostics.length > 0 ? { diagnostics } : {}),
      ...(attempt > 1 ? { previousSource: source } : {}),
      ...(priorSource === undefined ? {} : { priorSource }),
    });

    const raw = await options.generate(prompt);
    const candidate = extractCandidate(raw);
    await write(options.target, candidate);

    const check = await runCheckJson({
      file: options.target,
      ...(options.strict === undefined ? {} : { strict: options.strict }),
      ...(options.executable === undefined ? {} : { executable: options.executable }),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.runner === undefined ? {} : { runner: options.runner }),
    });

    const ranked = rankDiagnostics(check.diagnostics);
    const record: AgentAttempt = {
      attempt,
      promptHash: hashPrompt(prompt),
      source: candidate,
      diagnostics: ranked,
    };
    history.push(record);
    options.onAttempt?.(record);

    priorSource = source === "" ? undefined : source;
    source = candidate;
    diagnostics = ranked;

    if (check.ok) {
      return {
        status: "passed",
        target: options.target,
        attempts: attempt,
        source,
        diagnostics: [],
        history,
        metrics: computeRunMetrics({ status: "passed", attempts: attempt }),
      };
    }
  }

  return {
    status: "escalated",
    target: options.target,
    attempts: retries,
    source,
    diagnostics,
    history,
    metrics: computeRunMetrics({ status: "escalated", attempts: retries }),
  };
}

async function defaultWriteFile(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await fsWriteFile(path, contents, "utf8");
}