import { BridgeDefinitionError } from "../errors.js";
import { formatInterfaceProblem, validateInterface } from "../validate.js";
import type { CStruct, ExternFunc, Interface, NamedError } from "../xzint/ast.js";
import { mapXzTypeToFfi, type FfiType } from "./types.js";

export interface SymbolContract {
  readonly okCode: number;
  readonly outParam: string;
  readonly errorNames?: Readonly<Record<number, string>>;
}

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
  /**
   * The `Result`-contract descriptor (docs/01 §5, pattern 1). Present when the
   * symbol is a contracted wrapper: it returns an `Int`/`usize` status and
   * writes its value through one `mut` out-parameter. The descriptor names that
   * out-parameter, the ok status code, and the `@error` names, so a
   * manifest-only consumer can re-raise the status without re-reading the
   * interface.
   */
  readonly contract?: SymbolContract;
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
  const errorNames = contractErrorNames(iface.errors);
  for (const func of iface.funcs) {
    const definition: SymbolDefinition = {
      args: func.params.map((param) =>
        param.mutable ? "ptr" : mapXzTypeToFfi(param.type, cstructs, "param"),
      ),
      returns: mapXzTypeToFfi(func.returnType, cstructs, "return"),
      ...(func.release === undefined ? {} : { release: func.release }),
      ...(func.contract === undefined
        ? {}
        : { contract: buildContract(func, errorNames) }),
    };
    symbols[func.name] = definition;
  }
  return { name: input.name, path: input.path, xzVersion: input.xzVersion, symbols };
}

function buildContract(
  func: ExternFunc,
  errorNames: Readonly<Record<number, string>> | undefined,
): SymbolContract {
  const out = func.params.find((param) => param.mutable);
  if (out === undefined || func.contract === undefined) {
    throw new BridgeDefinitionError(
      `symbol '${func.name}': a contract descriptor requires one validated mut out-parameter`,
    );
  }
  return {
    okCode: func.contract.okCode,
    outParam: out.name,
    ...(errorNames === undefined ? {} : { errorNames }),
  };
}

function contractErrorNames(
  errors: readonly NamedError[],
): Readonly<Record<number, string>> | undefined {
  if (errors.length === 0) {
    return undefined;
  }
  const names: Record<number, string> = {};
  for (const error of errors) {
    names[error.code] = error.name;
  }
  return names;
}
