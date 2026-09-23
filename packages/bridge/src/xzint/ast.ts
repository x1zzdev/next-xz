export type PrimitiveType =
  | "Bool"
  | "Int"
  | "usize"
  | "Float"
  | "Char"
  | "Str"
  | "Bytes"
  | "Ptr"
  | "Unit";

export interface NamedType {
  readonly kind: "named";
  readonly name: string;
}

export interface GenericType {
  readonly kind: "generic";
  readonly name: string;
  readonly args: readonly XzType[];
}

export type XzType = NamedType | GenericType;

export interface Param {
  readonly name: string;
  readonly mutable: boolean;
  readonly transfer: boolean;
  readonly type: XzType;
}

export interface ExternFunc {
  readonly name: string;
  readonly params: readonly Param[];
  readonly returnType: XzType;
  readonly transferReturn: boolean;
  readonly release?: string;
  readonly contract?: Contract;
}

/**
 * The `Result`-contract wrapper a symbol declares (docs/01 §5, pattern 1): the
 * symbol returns a status `Int`/`usize` and writes its value through one `mut`
 * out-parameter. The interface-level `@error` map names the non-ok codes.
 */
export interface Contract {
  readonly okCode: number;
}

/** A named non-ok status code from an interface-level `@error Name = code` line. */
export interface NamedError {
  readonly name: string;
  readonly code: number;
}

export interface Field {
  readonly name: string;
  readonly type: XzType;
}

export interface CStruct {
  readonly name: string;
  readonly fields: readonly Field[];
}

export type InterfaceKind = "export" | "foreign";

export interface Interface {
  readonly kind: InterfaceKind;
  readonly funcs: readonly ExternFunc[];
  readonly cstructs: readonly CStruct[];
  readonly errors: readonly NamedError[];
}
