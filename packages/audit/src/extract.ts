import { isEffectLabel, type EffectLabel } from "./effects.js";

export interface TrustedClaim {
  readonly claim: string;
  readonly note: string;
}

export interface DocClaims {
  readonly intent: string;
  readonly declaredEffects: readonly EffectLabel[];
  readonly requires: readonly string[];
  readonly ensures: readonly string[];
  readonly trustedClaims: readonly TrustedClaim[];
}

interface ParsedDocLine {
  readonly tag: string | undefined;
  readonly text: string;
  readonly trusted: boolean;
  readonly note: string | undefined;
}

interface DocDeclaration {
  readonly docLines: readonly string[];
  readonly declIndex: number;
}

const TRUSTED_RE = /@trusted\b/;
const NOTE_RE = /\/\/\s*(.*)$/;
const TAG_RE = /^@([a-z]+)\b\s*(.*)$/;

export function extractDocClaims(source: string): DocClaims {
  const lines = source.split(/\r?\n/);
  const declaration = findDocDeclaration(lines);
  const parsed = (declaration?.docLines ?? []).map(parseDocLine);
  return {
    intent: firstText(parsed, "intent"),
    declaredEffects: parseEffects(textsFor(parsed, "effects")),
    requires: textsFor(parsed, "requires"),
    ensures: textsFor(parsed, "ensures"),
    trustedClaims: parsed
      .filter((line) => line.trusted && (line.tag === "requires" || line.tag === "ensures"))
      .map((line) => ({ claim: line.text, note: line.note ?? "" })),
  };
}

export function extractSignature(source: string): string {
  const lines = source.split(/\r?\n/);
  const index = lines.findIndex(isPublicDeclaration);
  if (index === -1) {
    return "";
  }
  const parts: string[] = [];
  for (let i = index; i < lines.length; i += 1) {
    const trimmed = (lines[i] ?? "").trim();
    if (i > index && (trimmed.startsWith("pre") || trimmed.startsWith("post"))) {
      break;
    }
    parts.push(trimmed.replace(/\{.*$/, "").trim());
    if (trimmed.includes("{")) {
      break;
    }
  }
  return parts
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/^@export\s+/, "")
    .trim();
}

function findDocDeclaration(lines: readonly string[]): DocDeclaration | undefined {
  let i = 0;
  while (i < lines.length) {
    if (!(lines[i] ?? "").trimStart().startsWith("///")) {
      i += 1;
      continue;
    }
    const start = i;
    while (i < lines.length && (lines[i] ?? "").trimStart().startsWith("///")) {
      i += 1;
    }
    let j = i;
    while (j < lines.length && (lines[j] ?? "").trim() === "") {
      j += 1;
    }
    if (isPublicDeclaration(lines[j] ?? "")) {
      return { docLines: lines.slice(start, i), declIndex: j };
    }
  }
  return undefined;
}

function isPublicDeclaration(line: string): boolean {
  const trimmed = line.trim();
  const body = trimmed.startsWith("@export")
    ? trimmed.slice("@export".length).trim()
    : trimmed;
  return /^(async\s+)?(func|task)\b/.test(body);
}

function parseDocLine(raw: string): ParsedDocLine {
  let text = raw.trimStart().replace(/^\/\/\//, "").trim();
  let trusted = false;
  let note: string | undefined;

  const noteMatch = text.match(NOTE_RE);
  if (noteMatch) {
    note = (noteMatch[1] ?? "").trim();
    text = text.slice(0, noteMatch.index ?? 0).trim();
  }
  if (TRUSTED_RE.test(text)) {
    trusted = true;
    text = text.replace(TRUSTED_RE, "").trim();
  }

  const tagMatch = text.match(TAG_RE);
  if (tagMatch) {
    return { tag: tagMatch[1], text: (tagMatch[2] ?? "").trim(), trusted, note };
  }
  return { tag: undefined, text, trusted, note };
}

function textsFor(lines: readonly ParsedDocLine[], tag: string): string[] {
  return lines.filter((line) => line.tag === tag).map((line) => line.text);
}

function firstText(lines: readonly ParsedDocLine[], tag: string): string {
  return textsFor(lines, tag)[0] ?? "";
}

function parseEffects(values: readonly string[]): EffectLabel[] {
  const labels: EffectLabel[] = [];
  for (const value of values) {
    for (const part of value.split(",")) {
      const label = part.trim();
      if (isEffectLabel(label) && !labels.includes(label)) {
        labels.push(label);
      }
    }
  }
  return labels;
}
