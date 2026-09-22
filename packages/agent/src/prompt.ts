import type { Diagnostic } from "./diagnostics.js";
import { rankDiagnostics } from "./ranking.js";

export interface Prompt {
  readonly system: string;
  readonly user: string;
}

export type GenerateText = (prompt: Prompt) => Promise<string>;

export const SYSTEM_PROMPT = [
  "You write Xz source files. Xz is a strict language: the compiler verifies every claim.",
  "",
  "Invariants you must preserve:",
  "- Public `func`/`task` (except `main`) require an intent comment (I0022).",
  "- Every claim must be paired with a formal `pre`/`post` (I0021).",
  "- `@effects` must match the derived profile (I0020); allowed labels are `none`, `mut`, `io`, `chan`, `extern` (I0024).",
  "- An unprovable claim needs `@trusted` with a review note, and only in `--strict` (I0001, I0004).",
  "- `Result` types carry the single error channel; Xz has no exceptions.",
  "",
  "You may only edit `.xz` and `.xzint` files. Never edit application, routing, or config files.",
].join("\n");

export interface PromptContext {
  readonly intent: string;
  readonly target: string;
  readonly attempt: number;
  readonly retries: number;
  readonly shell?: string;
  readonly previousSource?: string;
  readonly priorSource?: string;
  readonly diagnostics?: readonly Diagnostic[];
}

export function buildPrompt(context: PromptContext): Prompt {
  const lines: string[] = [];
  lines.push("Intent:");
  lines.push(context.intent.trim());
  lines.push("");
  lines.push(`Target file: ${context.target}`);
  lines.push(`Attempt ${context.attempt} of ${context.retries}.`);

  if (context.shell !== undefined && context.shell.trim() !== "") {
    lines.push("");
    lines.push("Contract shell to preserve:");
    lines.push(context.shell.trim());
  }

  lines.push("");
  lines.push("Output rules:");
  lines.push("- Return only the complete contents of the target file.");
  lines.push("- Do not wrap the result in code fences and do not add prose.");
  lines.push("- Edit only `.xz` and `.xzint` files.");

  if (context.attempt > 1 && context.diagnostics !== undefined) {
    lines.push("");
    lines.push("Repair:");
    lines.push("The previous candidate failed `xz check-json`.");
    if (context.previousSource !== undefined && context.priorSource !== undefined) {
      lines.push(
        `Change since the previous attempt: ${summarizeChange(context.priorSource, context.previousSource)}.`,
      );
    }
    lines.push("Diagnostics (ranked):");
    for (const line of formatDiagnostics(context.diagnostics)) {
      lines.push(line);
    }
    if (context.previousSource !== undefined) {
      lines.push("");
      lines.push("Previous candidate:");
      lines.push(context.previousSource);
    }
  }

  return { system: SYSTEM_PROMPT, user: lines.join("\n") };
}

export function formatDiagnostics(diagnostics: readonly Diagnostic[]): string[] {
  return rankDiagnostics(diagnostics).map((diagnostic) => {
    const head = `- [${diagnostic.severity}] ${diagnostic.code} (${diagnostic.category}) ${diagnostic.span.file}:${diagnostic.span.start[0]}:${diagnostic.span.start[1]}: ${diagnostic.message}`;
    if (diagnostic.suggestion === undefined) {
      return head;
    }
    return `${head}\n  fix (${diagnostic.suggestion.confidence.toFixed(2)}): ${diagnostic.suggestion.fix}`;
  });
}

export function extractCandidate(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(trimmed);
  return fenced !== null ? (fenced[1] ?? trimmed) : trimmed;
}

export function summarizeChange(previous: string, current: string): string {
  const before = previous === "" ? [] : previous.split("\n");
  const after = current === "" ? [] : current.split("\n");
  const common = longestCommonSubsequenceLength(before, after);
  const removed = before.length - common;
  const added = after.length - common;
  if (removed === 0 && added === 0) {
    return "no line changes";
  }
  return `${added} line(s) added, ${removed} line(s) removed`;
}

function longestCommonSubsequenceLength(before: readonly string[], after: readonly string[]): number {
  let previousRow = new Array<number>(after.length + 1).fill(0);
  for (let i = 1; i <= before.length; i += 1) {
    const currentRow = new Array<number>(after.length + 1).fill(0);
    for (let j = 1; j <= after.length; j += 1) {
      currentRow[j] =
        before[i - 1] === after[j - 1]
          ? (previousRow[j - 1] ?? 0) + 1
          : Math.max(previousRow[j] ?? 0, currentRow[j - 1] ?? 0);
    }
    previousRow = currentRow;
  }
  return previousRow[after.length] ?? 0;
}