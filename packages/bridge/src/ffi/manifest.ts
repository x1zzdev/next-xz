import { BridgeDefinitionError } from "../errors.js";
import { formatInterfaceProblem, validateInterface } from "../validate.js";
import type { CStruct, Interface } from "../xzint/ast.js";
import { mapXzTypeToFfi, type FfiType } from "./types.js";

export interface SymbolDefinition {
  readonly args: readonly FfiType[];
  readonly returns: FfiType;
  /**
   * The deallocator for a `transfer` return. The returned buffer moves to the
   * caller, so it must be freed through this symbol (a borrowed-`Ptr`-taking
   * `Unit` function declared in the same interface). Present exactly when the
   * symbol's return is `transfer`, so a manifest-only consumer sees the
   * ownership and release channel without re-reading the interface.
   */
  readonly release?: string;
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
  const problems = validateInterface(iface);
  if (problems.length > 0) {
    throw new BridgeDefinitionError(formatInterfaceProblem(problems[0]!));
  }
  const cstructs: ReadonlyMap<string, CStruct> = new Map(
    iface.cstructs.map((cstruct) => [cstruct.name, cstruct]),
  );
  const symbols: Record<string, SymbolDefinition> = {};
  for (const func of iface.funcs) {
    const definition: SymbolDefinition = {
      args: func.params.map((param) =>
        param.mutable ? "ptr" : mapXzTypeToFfi(param.type, cstructs, "param"),
      ),
      returns: mapXzTypeToFfi(func.returnType, cstructs, "return"),
    };
    symbols[func.name] =
      func.release === undefined ? definition : { ...definition, release: func.release };
  }
  return { name: input.name, path: input.path, xzVersion: input.xzVersion, symbols };
}
