export class DiagnosticParseError extends Error {
  readonly source: string;

  constructor(message: string, source: string) {
    super(`Invalid xz check-json output: ${message}`);
    this.name = "DiagnosticParseError";
    this.source = source;
  }
}

export class AgentScopeError extends Error {
  readonly target: string;

  constructor(target: string) {
    super(`refusing to write '${target}': the agent may only edit .xz and .xzint files`);
    this.name = "AgentScopeError";
    this.target = target;
  }
}

export interface CheckProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export class XzCheckError extends Error {
  readonly executable: string;
  readonly file: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly hint: string | undefined;

  constructor(
    executable: string,
    file: string,
    result: CheckProcessResult,
    reason: string,
    hint?: string,
  ) {
    super(
      `'${executable} check-json ${file}' did not emit a diagnostic array (${reason}); exit ${result.exitCode}${
        hint === undefined ? "" : `; ${hint}`
      }`,
    );
    this.name = "XzCheckError";
    this.executable = executable;
    this.file = file;
    this.exitCode = result.exitCode;
    this.stdout = result.stdout;
    this.stderr = result.stderr;
    this.hint = hint;
  }
}