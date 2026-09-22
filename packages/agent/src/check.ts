import { spawn } from "node:child_process";

import { parseDiagnostics, type Diagnostic } from "./diagnostics.js";
import { DiagnosticParseError, XzCheckError, type CheckProcessResult } from "./errors.js";

export type { CheckProcessResult } from "./errors.js";

export interface ProcessRunnerOptions {
  readonly cwd?: string;
}

export type ProcessRunner = (
  command: string,
  args: readonly string[],
  options: ProcessRunnerOptions,
) => Promise<CheckProcessResult>;

export interface CheckJsonOptions {
  readonly file: string;
  readonly strict?: boolean;
  readonly executable?: string;
  readonly cwd?: string;
  readonly runner?: ProcessRunner;
}

export interface CheckJsonResult {
  readonly file: string;
  readonly ok: boolean;
  readonly exitCode: number;
  readonly diagnostics: readonly Diagnostic[];
  readonly stderr: string;
}

export function resolveExecutable(explicit?: string): string {
  return explicit ?? process.env["XZ_CLI"] ?? "xz";
}

export async function runCheckJson(options: CheckJsonOptions): Promise<CheckJsonResult> {
  const executable = resolveExecutable(options.executable);
  const args = [
    "check-json",
    ...(options.strict === true ? ["--strict"] : []),
    options.file,
  ];
  const runner = options.runner ?? spawnRunner;
  const result = await runner(executable, args, options.cwd === undefined ? {} : { cwd: options.cwd });

  let diagnostics: Diagnostic[];
  try {
    diagnostics = parseDiagnostics(result.stdout);
  } catch (error) {
    if (error instanceof DiagnosticParseError) {
      throw new XzCheckError(executable, options.file, result, error.message);
    }
    throw error;
  }

  return {
    file: options.file,
    ok: diagnostics.length === 0,
    exitCode: result.exitCode,
    diagnostics,
    stderr: result.stderr,
  };
}

export const spawnRunner: ProcessRunner = (command, args, options) =>
  new Promise<CheckProcessResult>((resolve, reject) => {
    const child = spawn(command, [...args], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });