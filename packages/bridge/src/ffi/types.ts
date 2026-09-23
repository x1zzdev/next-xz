import { BridgeDefinitionError } from "../errors.js";
import { isPrimitive, renderXzType, type PrimitiveName, type TypePosition } from "../type-map.js";
import type { CStruct, XzType } from "../xzint/ast.js";

export type FfiScalar = "bool" | "int64" | "uint64" | "double" | "char" | "ptr" | "void";

export interface FfiStructField {
  readonly name: string;
  readonly type: FfiType;
}

export interface FfiStruct {
  readonly kind: "struct";
  readonly name: string;
  readonly fields: readonly FfiStructField[];
}

export type FfiType = FfiScalar | FfiStruct;

const PRIMITIVE_FFI: Readonly<Record<PrimitiveName, FfiType>> = {
  Bool: "bool",
  Int: "int64",
  usize: "uint64",
  Float: "double",
  Char: "char",
  Str: {
    kind: "struct",
    name: "XzStr",
    fields: [
      { name: "ptr", type: "ptr" },
      { name: "len", type: "uint64" },
    ],
  },
  Bytes: {
    kind: "struct",
    name: "XzBytes",
    fields: [
      { name: "ptr", type: "ptr" },
      { name: "len", type: "uint64" },
    ],
  },
  Ptr: "ptr",
  Unit: "void",
};

/**
 * Maps an already-validated `.xzint` type to its backend-neutral FFI form.
 *
 * `validateInterface` is the single owner of the C-representability and cycle
 * rules. This function performs structural mapping only and assumes the
 * interface passed those checks; the throws below mark an internal invariant
 * violation, not a second copy of the rules. It stays a public structural
 * helper for parity with `mapTypeToTs`; the supported entry points are
 * `manifestFromInterface` and `generateBinding`, which validate first. Calling
 * it on an unvalidated type throws `BridgeDefinitionError` with the internal
 * invariant message.
 *
 * @throws {BridgeDefinitionError} if the type was not validated first (generic,
 * `Unit` outside a return, unknown name, or a record cycle)
 */
export function mapXzTypeToFfi(
  type: XzType,
  cstructs: ReadonlyMap<string, CStruct>,
  position: TypePosition = "param",
): FfiType {
  return mapType(type, cstructs, position, new Set());
}

function mapType(
  type: XzType,
  cstructs: ReadonlyMap<string, CStruct>,
  position: TypePosition,
  seen: ReadonlySet<string>,
): FfiType {
  if (type.kind === "generic") {
    throw unvalidatedMapping(renderXzType(type));
  }
  if (isPrimitive(type.name)) {
    if (type.name === "Unit" && position !== "return") {
      throw unvalidatedMapping("Unit");
    }
    return PRIMITIVE_FFI[type.name];
  }
  const record = cstructs.get(type.name);
  if (record === undefined) {
    throw unvalidatedMapping(type.name);
  }
  if (seen.has(record.name)) {
    throw unvalidatedMapping(record.name);
  }
  const nested = new Set(seen);
  nested.add(record.name);
  return {
    kind: "struct",
    name: record.name,
    fields: record.fields.map((field) => ({
      name: field.name,
      type: mapType(field.type, cstructs, "field", nested),
    })),
  };
}

function unvalidatedMapping(xzType: string): BridgeDefinitionError {
  return new BridgeDefinitionError(
    `Cannot map Xz type '${xzType}' to an FFI type: the interface must pass validateInterface before mapping`,
  );
}
