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
}

export interface Field {
  readonly name: string;
  readonly type: XzType;
}

export interface CStruct {
  readonly name: string;
  readonly fields: readonly Field[];
}

export interface Interface {
  readonly funcs: readonly ExternFunc[];
  readonly cstructs: readonly CStruct[];
}
