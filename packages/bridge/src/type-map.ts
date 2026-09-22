import { NotCRepresentableError } from "./errors.js";
import type { Interface, XzType } from "./xzint/ast.js";

export type PrimitiveName =
  | "Bool"
  | "Int"
  | "usize"
  | "Float"
  | "Char"
  | "Str"
  | "Bytes"
  | "Ptr"
  | "Unit";

export type TypePosition = "param" | "return" | "field";

export interface PrimitiveMapping {
  readonly xz: PrimitiveName;
  readonly c: string;
  readonly ts: string;
  readonly note?: string;
}

export const PRIMITIVE_MAP: readonly PrimitiveMapping[] = [
  { xz: "Bool", c: "bool", ts: "boolean" },
  { xz: "Int", c: "int64_t", ts: "number", note: "bigint for values beyond 2^53" },
  { xz: "usize", c: "uint64_t", ts: "number", note: "bigint for values beyond 2^53" },
  { xz: "Float", c: "double", ts: "number" },
  { xz: "Char", c: "char", ts: "string", note: "single-character string" },
  {
    xz: "Str",
    c: "XzStr { const char* ptr; size_t len; }",
    ts: "string",
    note: "UTF-8 encoded; Uint8Array zero-copy is P1",
  },
  { xz: "Bytes", c: "XzBytes { uint8_t* ptr; size_t len; }", ts: "Uint8Array" },
  { xz: "Ptr", c: "void*", ts: "unknown", note: "opaque handle, never copied" },
  { xz: "Unit", c: "void", ts: "void", note: "return only" },
];

export const NON_C_REPRESENTABLE: readonly string[] = [
  "Result",
  "Option",
  "List",
  "Map",
  "Set",
  "Chan",
  "enum",
  "record",
];

const PRIMITIVES: ReadonlyMap<string, PrimitiveMapping> = new Map(
  PRIMITIVE_MAP.map((mapping) => [mapping.xz, mapping]),
);

export function isPrimitive(name: string): name is PrimitiveName {
  return PRIMITIVES.has(name);
}

export function cstructNames(iface: Interface): ReadonlySet<string> {
  return new Set(iface.cstructs.map((cstruct) => cstruct.name));
}

export function isCRepresentable(
  type: XzType,
  cstructs: ReadonlySet<string>,
  position: TypePosition = "param",
): boolean {
  if (type.kind === "generic") {
    return false;
  }
  if (PRIMITIVES.has(type.name)) {
    return type.name === "Unit" ? position === "return" : true;
  }
  return cstructs.has(type.name);
}

export function mapTypeToTs(
  type: XzType,
  cstructs: ReadonlySet<string>,
  position: TypePosition = "param",
): string {
  if (type.kind === "generic") {
    throw new NotCRepresentableError(
      renderXzType(type),
      `generic type '${type.name}' has no C declaration`,
    );
  }
  const primitive = PRIMITIVES.get(type.name);
  if (primitive !== undefined) {
    if (type.name === "Unit" && position !== "return") {
      throw new NotCRepresentableError("Unit", "Unit is allowed only as a return type");
    }
    return primitive.ts;
  }
  if (cstructs.has(type.name)) {
    return type.name;
  }
  throw new NotCRepresentableError(
    type.name,
    "unknown type; declare it as a @cstruct record or use a C-representable primitive",
  );
}

export function renderXzType(type: XzType): string {
  if (type.kind === "named") {
    return type.name;
  }
  return `${type.name}[${type.args.map(renderXzType).join(", ")}]`;
}
