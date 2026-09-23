import { BridgeDefinitionError } from "./errors.js";
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

/**
 * Maps an already-validated `.xzint` type to its TypeScript type.
 *
 * `validateInterface` is the single owner of the C-representability rules.
 * This function performs structural mapping only and assumes the interface
 * passed those checks; the throws below mark an internal invariant violation,
 * not a second copy of the rules.
 */
export function mapTypeToTs(
  type: XzType,
  cstructs: ReadonlySet<string>,
  position: TypePosition = "param",
): string {
  if (type.kind === "generic") {
    throw unvalidatedMapping(renderXzType(type));
  }
  const primitive = PRIMITIVES.get(type.name);
  if (primitive !== undefined) {
    if (type.name === "Unit" && position !== "return") {
      throw unvalidatedMapping("Unit");
    }
    return primitive.ts;
  }
  if (cstructs.has(type.name)) {
    return type.name;
  }
  throw unvalidatedMapping(type.name);
}

function unvalidatedMapping(xzType: string): BridgeDefinitionError {
  return new BridgeDefinitionError(
    `Cannot map Xz type '${xzType}' to a TypeScript type: the interface must pass validateInterface before mapping`,
  );
}

export function renderXzType(type: XzType): string {
  if (type.kind === "named") {
    return type.name;
  }
  return `${type.name}[${type.args.map(renderXzType).join(", ")}]`;
}
