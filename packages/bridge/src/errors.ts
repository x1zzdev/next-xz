export class XzintParseError extends Error {
  readonly file: string;
  readonly line: number;
  readonly column: number;

  constructor(message: string, file: string, line: number, column: number) {
    super(`${file}:${line}:${column}: ${message}`);
    this.name = "XzintParseError";
    this.file = file;
    this.line = line;
    this.column = column;
  }
}

export class NotCRepresentableError extends Error {
  readonly xzType: string;

  constructor(xzType: string, reason: string) {
    super(`Xz type '${xzType}' is not C-representable: ${reason}`);
    this.name = "NotCRepresentableError";
    this.xzType = xzType;
  }
}
