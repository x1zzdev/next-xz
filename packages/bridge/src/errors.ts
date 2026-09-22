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

export class BridgeDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeDefinitionError";
  }
}

export class BridgeVersionError extends Error {
  readonly library: string;
  readonly expected: string;
  readonly actual: string;

  constructor(library: string, expected: string, actual: string) {
    super(`Xz version mismatch for '${library}': expected ${expected}, library built with ${actual}`);
    this.name = "BridgeVersionError";
    this.library = library;
    this.expected = expected;
    this.actual = actual;
  }
}

export class BridgeSymbolError extends Error {
  readonly library: string;
  readonly symbol: string;

  constructor(library: string, symbol: string, reason: string) {
    super(`Symbol '${symbol}' in '${library}': ${reason}`);
    this.name = "BridgeSymbolError";
    this.library = library;
    this.symbol = symbol;
  }
}

export class BridgeRuntimeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BridgeRuntimeError";
  }
}
