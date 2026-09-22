import { DiagnosticParseError } from "./errors.js";

export type DiagnosticSeverity = "error" | "warning";

export type DiagnosticCategory = "lex" | "parse" | "resolve" | "type" | "intent";

export type DiagnosticPosition = readonly [line: number, column: number];

export interface DiagnosticSpan {
  readonly file: string;
  readonly start: DiagnosticPosition;
  readonly end: DiagnosticPosition;
}

export interface DiagnosticSuggestion {
  readonly fix: string;
  readonly confidence: number;
}

export interface Diagnostic {
  readonly version: number;
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly category: DiagnosticCategory;
  readonly span: DiagnosticSpan;
  readonly suggestion?: DiagnosticSuggestion;
}

const SEVERITIES: readonly DiagnosticSeverity[] = ["error", "warning"];

const CATEGORIES: readonly DiagnosticCategory[] = ["lex", "parse", "resolve", "type", "intent"];

export function parseDiagnostics(json: string): Diagnostic[] {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new DiagnosticParseError(`not valid JSON (${detail})`, json);
  }
  if (!Array.isArray(value)) {
    throw new DiagnosticParseError("expected a JSON array", json);
  }
  return value.map((entry, index) => parseDiagnostic(entry, `[${index}]`));
}

function parseDiagnostic(value: unknown, path: string): Diagnostic {
  const record = expectRecord(value, path);
  const version = expectInteger(record["version"], `${path}.version`);
  const severity = expectEnum(record["severity"], `${path}.severity`, SEVERITIES);
  const code = expectString(record["code"], `${path}.code`);
  const message = expectString(record["message"], `${path}.message`);
  const category = expectEnum(record["category"], `${path}.category`, CATEGORIES);
  const span = parseSpan(record["span"], `${path}.span`);
  const suggestion =
    record["suggestion"] === undefined
      ? undefined
      : parseSuggestion(record["suggestion"], `${path}.suggestion`);

  return { version, severity, code, message, category, span, ...(suggestion === undefined ? {} : { suggestion }) };
}

function parseSpan(value: unknown, path: string): DiagnosticSpan {
  const record = expectRecord(value, path);
  return {
    file: expectString(record["file"], `${path}.file`),
    start: parsePosition(record["start"], `${path}.start`),
    end: parsePosition(record["end"], `${path}.end`),
  };
}

function parsePosition(value: unknown, path: string): DiagnosticPosition {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new DiagnosticParseError(`expected a [line, column] pair at ${path}`, JSON.stringify(value));
  }
  return [expectInteger(value[0], `${path}[0]`), expectInteger(value[1], `${path}[1]`)];
}

function parseSuggestion(value: unknown, path: string): DiagnosticSuggestion {
  const record = expectRecord(value, path);
  return {
    fix: expectString(record["fix"], `${path}.fix`),
    confidence: expectNumber(record["confidence"], `${path}.confidence`),
  };
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DiagnosticParseError(`expected an object at ${path}`, JSON.stringify(value));
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new DiagnosticParseError(`expected a string at ${path}`, JSON.stringify(value));
  }
  return value;
}

function expectNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DiagnosticParseError(`expected a finite number at ${path}`, JSON.stringify(value));
  }
  return value;
}

function expectInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new DiagnosticParseError(`expected an integer at ${path}`, JSON.stringify(value));
  }
  return value;
}

function expectEnum<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  const candidate = expectString(value, path);
  if (!allowed.includes(candidate as T)) {
    throw new DiagnosticParseError(
      `expected one of ${allowed.map((option) => `'${option}'`).join(", ")} at ${path}`,
      JSON.stringify(value),
    );
  }
  return candidate as T;
}