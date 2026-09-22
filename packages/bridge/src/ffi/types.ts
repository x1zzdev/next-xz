import { NotCRepresentableError } from "../errors.js";
import { isPrimitive, renderXzType, type PrimitiveName, type TypePosition } from "../type-map.js";
import type { CStruct, XzType } from "../xzint/ast.js";

export type FfiScalar = "bool" | "int64" | "uint64" | "double" | "char" | "ptr" | "void";

export interface FfiStruct {
  readonly kind: "struct";
  readonly name: string;
  readonly fields: readonly FfiType[];
}

export type FfiType = FfiScalar | FfiStruct;

const PRIMITIVE_FFI: Readonly<Record<PrimitiveName, FfiType>> = {
  Bool: "bool",
  Int: "int64",
  usize: "uint64",
  Float: "double",
  Char: "char",
  Str: { kind: "struct", name: "XzStr", fields: ["ptr", "uint64"] },
  Bytes: { kind: "struct", name: "XzBytes", fields: ["ptr", "uint64"] },
  Ptr: "ptr",
  Unit: "void",
};

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
    throw new NotCRepresentableError(
      renderXzType(type),
      `generic type '${type.name}' has no C declaration`,
    );
  }
  if (isPrimitive(type.name)) {
    if (type.name === "Unit" && position !== "return") {
      throw new NotCRepresentableError("Unit", "Unit is allowed only as a return type");
    }
    return PRIMITIVE_FFI[type.name];
  }
  const record = cstructs.get(type.name);
  if (record === undefined) {
    throw new NotCRepresentableError(
      type.name,
      "unknown type; declare it as a @cstruct record or use a C-representable primitive",
    );
  }
  if (seen.has(record.name)) {
    throw new NotCRepresentableError(record.name, "@cstruct records must not form a cycle");
  }
  const nested = new Set(seen);
  nested.add(record.name);
  return {
    kind: "struct",
    name: record.name,
    fields: record.fields.map((field) => mapType(field.type, cstructs, "field", nested)),
  };
}
