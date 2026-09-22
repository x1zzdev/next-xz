import { XzintParseError } from "../errors.js";

export type TokenKind =
  | "ident"
  | "at"
  | "lparen"
  | "rparen"
  | "lbrace"
  | "rbrace"
  | "lbracket"
  | "rbracket"
  | "comma"
  | "colon"
  | "pipe"
  | "arrow"
  | "eof";

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly line: number;
  readonly column: number;
}

const PUNCTUATION: Readonly<Record<string, TokenKind>> = {
  "(": "lparen",
  ")": "rparen",
  "{": "lbrace",
  "}": "rbrace",
  "[": "lbracket",
  "]": "rbracket",
  ",": "comma",
  ":": "colon",
  "|": "pipe",
};

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;

export function tokenize(source: string, file: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let line = 1;
  let column = 1;
  const length = source.length;

  while (index < length) {
    const char = source[index]!;

    if (char === "\n") {
      line += 1;
      column = 1;
      index += 1;
      continue;
    }
    if (char === " " || char === "\t" || char === "\r") {
      column += 1;
      index += 1;
      continue;
    }
    if (char === "/" && source[index + 1] === "/") {
      while (index < length && source[index] !== "\n") {
        index += 1;
        column += 1;
      }
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      index += 2;
      column += 2;
      let closed = false;
      while (index < length) {
        if (source[index] === "*" && source[index + 1] === "/") {
          index += 2;
          column += 2;
          closed = true;
          break;
        }
        if (source[index] === "\n") {
          line += 1;
          column = 1;
          index += 1;
        } else {
          index += 1;
          column += 1;
        }
      }
      if (!closed) {
        throw new XzintParseError("unterminated block comment", file, line, column);
      }
      continue;
    }

    const startLine = line;
    const startColumn = column;

    if (IDENT_START.test(char)) {
      let text = "";
      while (index < length && IDENT_PART.test(source[index]!)) {
        text += source[index];
        index += 1;
        column += 1;
      }
      tokens.push({ kind: "ident", text, line: startLine, column: startColumn });
      continue;
    }

    if (char === "-" && source[index + 1] === ">") {
      tokens.push({ kind: "arrow", text: "->", line: startLine, column: startColumn });
      index += 2;
      column += 2;
      continue;
    }

    if (char === "@") {
      tokens.push({ kind: "at", text: "@", line: startLine, column: startColumn });
      index += 1;
      column += 1;
      continue;
    }

    const kind = PUNCTUATION[char];
    if (kind !== undefined) {
      tokens.push({ kind, text: char, line: startLine, column: startColumn });
      index += 1;
      column += 1;
      continue;
    }

    throw new XzintParseError(`unexpected character '${char}'`, file, line, column);
  }

  tokens.push({ kind: "eof", text: "", line, column });
  return tokens;
}
