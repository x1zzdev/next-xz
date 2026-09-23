import { XzintParseError } from "../errors.js";
import type {
  CStruct,
  Contract,
  ExternFunc,
  Field,
  Interface,
  InterfaceKind,
  NamedError,
  NamedType,
  Param,
  XzType,
} from "./ast.js";
import { tokenize, type Token, type TokenKind } from "./token.js";

const UNIT: NamedType = { kind: "named", name: "Unit" };

function buildExtern(
  name: string,
  params: readonly Param[],
  returnType: XzType,
  transferReturn: boolean,
  release: string | undefined,
  contract: Contract | undefined,
): ExternFunc {
  return {
    name,
    params,
    returnType,
    transferReturn,
    ...(release === undefined ? {} : { release }),
    ...(contract === undefined ? {} : { contract }),
  };
}

const KIND_LABEL: Readonly<Record<TokenKind, string>> = {
  ident: "identifier",
  at: "'@'",
  lparen: "'('",
  rparen: "')'",
  lbrace: "'{'",
  rbrace: "'}'",
  lbracket: "'['",
  rbracket: "']'",
  comma: "','",
  colon: "':'",
  pipe: "'|'",
  arrow: "'->'",
  equals: "'='",
  number: "integer",
  eof: "end of file",
};

export function parseInterface(source: string, file = "<xzint>"): Interface {
  return new Parser(tokenize(source, file), file).parseInterface();
}

class Parser {
  private position = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly file: string,
  ) {}

  parseInterface(): Interface {
    const kind = this.parseInterfaceKind();
    const funcs: ExternFunc[] = [];
    const cstructs: CStruct[] = [];
    const errors: NamedError[] = [];
    while (!this.at("eof")) {
      if (this.at("at")) {
        const annotation = this.peek(1);
        const text = annotation.kind === "ident" ? annotation.text : "";
        if (text === "interface") {
          throw this.error(
            "the '@interface' marker must appear exactly once, before any declaration",
          );
        }
        if (text === "error") {
          errors.push(this.parseNamedError());
          continue;
        }
        cstructs.push(this.parseCStruct());
      } else if (this.atIdent("extern")) {
        funcs.push(this.parseExtern());
      } else {
        const token = this.peek();
        throw this.error(
          `'.xzint' interface files may only declare 'extern func', '@cstruct record', and '@error Name = code'; found '${token.text || token.kind}'`,
        );
      }
    }
    return { kind, funcs, cstructs, errors };
  }

  private parseInterfaceKind(): InterfaceKind {
    if (!this.at("at")) {
      const token = this.peek();
      throw this.error(
        `'.xzint' interface files must open with exactly one '@interface export' or '@interface foreign' marker; found '${token.text || token.kind}'`,
      );
    }
    this.expect("at");
    const annotation = this.expectIdent();
    if (annotation !== "interface") {
      throw this.error(`expected '@interface export' or '@interface foreign'; found '@${annotation}'`);
    }
    const kind = this.expectIdent();
    if (kind !== "export" && kind !== "foreign") {
      throw this.error(`expected 'export' or 'foreign' after '@interface'; found '${kind}'`);
    }
    return kind;
  }

  private parseNamedError(): NamedError {
    this.expect("at");
    this.expectIdent("error");
    const name = this.expectIdent();
    this.expect("equals");
    return { name, code: this.parseNumber() };
  }

  private parseCStruct(): CStruct {
    this.expect("at");
    const annotation = this.expectIdent();
    if (annotation !== "cstruct") {
      throw this.error(`expected '@cstruct record'; found '@${annotation}'`);
    }
    this.expectIdent("record");
    const name = this.expectIdent();
    this.expect("lbrace");
    const fields: Field[] = [];
    while (!this.at("rbrace")) {
      const fieldName = this.expectIdent();
      this.expect("colon");
      fields.push({ name: fieldName, type: this.parseType() });
    }
    this.expect("rbrace");
    return { name, fields };
  }

  private parseExtern(): ExternFunc {
    this.expectIdent("extern");
    this.expectIdent("func");
    const name = this.expectIdent();
    if (this.at("lbracket")) {
      throw this.error(`generic extern func '${name}' is not C-representable`);
    }
    this.expect("lparen");
    const params: Param[] = [];
    if (!this.at("rparen")) {
      params.push(this.parseParam());
      while (this.match("comma")) {
        params.push(this.parseParam());
      }
    }
    this.expect("rparen");
    let returnType: XzType = UNIT;
    let transferReturn = false;
    let release: string | undefined;
    if (this.match("arrow")) {
      if (this.atIdent("transfer")) {
        this.advance();
        transferReturn = true;
      }
      returnType = this.parseType();
      if (this.atIdent("release")) {
        this.advance();
        release = this.expectIdent();
      }
    }
    const contract = this.parseContractClause();
    return buildExtern(name, params, returnType, transferReturn, release, contract);
  }

  private parseContractClause(): Contract | undefined {
    if (!this.atIdent("contract")) {
      return undefined;
    }
    this.advance();
    this.expectIdent("ok");
    return { okCode: this.parseNumber() };
  }

  private parseNumber(): number {
    const token = this.peek();
    if (token.kind !== "number") {
      throw this.error(`expected an integer; found '${token.text || token.kind}'`);
    }
    this.advance();
    return Number(token.text);
  }

  private parseParam(): Param {
    let mutable = false;
    let transfer = false;
    if (this.atIdent("mut")) {
      this.advance();
      mutable = true;
    } else if (this.atIdent("transfer")) {
      this.advance();
      transfer = true;
    }
    const name = this.expectIdent();
    this.expect("colon");
    return { name, mutable, transfer, type: this.parseType() };
  }

  private parseType(): XzType {
    const name = this.expectIdent();
    let type: XzType;
    if (this.match("lbracket")) {
      const args: XzType[] = [this.parseType()];
      while (this.match("comma")) {
        args.push(this.parseType());
      }
      this.expect("rbracket");
      type = { kind: "generic", name, args };
    } else {
      type = { kind: "named", name };
    }
    if (this.at("pipe")) {
      throw this.error("union types are not C-representable and are not allowed in '.xzint'");
    }
    return type;
  }

  private peek(offset = 0): Token {
    return this.tokens[this.position + offset]!;
  }

  private advance(): Token {
    const token = this.peek();
    if (token.kind !== "eof") {
      this.position += 1;
    }
    return token;
  }

  private at(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  private atIdent(text: string): boolean {
    const token = this.peek();
    return token.kind === "ident" && token.text === text;
  }

  private match(kind: TokenKind): boolean {
    if (this.at(kind)) {
      this.advance();
      return true;
    }
    return false;
  }

  private expect(kind: TokenKind): Token {
    if (!this.at(kind)) {
      const token = this.peek();
      throw this.error(`expected ${KIND_LABEL[kind]}; found '${token.text || token.kind}'`);
    }
    return this.advance();
  }

  private expectIdent(text?: string): string {
    const token = this.peek();
    if (token.kind !== "ident" || (text !== undefined && token.text !== text)) {
      throw this.error(`expected ${text === undefined ? "identifier" : `'${text}'`}; found '${token.text || token.kind}'`);
    }
    this.advance();
    return token.text;
  }

  private error(message: string): XzintParseError {
    const token = this.peek();
    return new XzintParseError(message, this.file, token.line, token.column);
  }
}
