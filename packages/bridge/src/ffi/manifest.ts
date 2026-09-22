import { BridgeDefinitionError } from "../errors.js";
import type { CStruct, Interface } from "../xzint/ast.js";
import { mapXzTypeToFfi, type FfiType } from "./types.js";

export interface SymbolDefinition {
  readonly args: readonly FfiType[];
  readonly returns: FfiType;
}

export interface LibraryManifest {
  readonly name: string;
  readonly path: string;
  readonly xzVersion: string;
  readonly symbols: Readonly<Record<string, SymbolDefinition>>;
}

export interface ManifestInput {
  readonly name: string;
  readonly path: string;
  readonly xzVersion: string;
}

export function manifestFromInterface(iface: Interface, input: ManifestInput): LibraryManifest {
  const cstructs: ReadonlyMap<string, CStruct> = new Map(
    iface.cstructs.map((cstruct) => [cstruct.name, cstruct]),
  );
  const symbols: Record<string, SymbolDefinition> = {};
  for (const func of iface.funcs) {
    if (Object.prototype.hasOwnProperty.call(symbols, func.name)) {
      throw new BridgeDefinitionError(
        `duplicate symbol '${func.name}' in interface '${input.name}'`,
      );
    }
    symbols[func.name] = {
      args: func.params.map((param) =>
        param.mutable ? "ptr" : mapXzTypeToFfi(param.type, cstructs, "param"),
      ),
      returns: mapXzTypeToFfi(func.returnType, cstructs, "return"),
    };
  }
  return { name: input.name, path: input.path, xzVersion: input.xzVersion, symbols };
}
