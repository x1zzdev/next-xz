import { XzintParseError } from "../errors.js";
import type { CStruct, ExternFunc, Field, Interface, NamedType, Param, XzType } from "./ast.js";
import { tokenize, type Token, type TokenKind } from "./token.js";

const UNIT: NamedType = { kind: "named", name: "Unit" };

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
    const funcs: ExternFunc[] = [];
    const cstructs: CStruct[] = [];
    while (!this.at("eof")) {
      if (this.at("at")) {
        cstructs.push(this.parseCStruct());
      } else if (this.atIdent("extern")) {
        funcs.push(this.parseExtern());
      } else {
        const token = this.peek();
        throw this.error(
          `'.xzint' interface files may only declare 'extern func' and '@cstruct record'; found '${token.text || token.kind}'`,
        );
      }
    }
    return { funcs, cstructs };
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
    if (this.match("arrow")) {
      returnType = this.parseType();
    }
    return { name, params, returnType };
  }

  private parseParam(): Param {
    let mutable = false;
    if (this.atIdent("mut")) {
      this.advance();
      mutable = true;
    }
    const name = this.expectIdent();
    this.expect("colon");
    return { name, mutable, type: this.parseType() };
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

  private peek(): Token {
    return this.tokens[this.position]!;
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
