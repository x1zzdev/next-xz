import { isPrimitive, renderXzType } from "./type-map.js";
import type { CStruct, ExternFunc, Interface, XzType } from "./xzint/ast.js";

export type ValidationPosition = "param" | "return" | "field" | "declaration";

export type InterfaceProblemKind =
  | "generic"
  | "unit"
  | "unknown"
  | "cycle"
  | "duplicate"
  | "reserved"
  | "ownership"
  | "release";

export interface InterfaceProblem {
  readonly kind: InterfaceProblemKind;
  readonly symbol: string;
  readonly position: ValidationPosition;
  readonly path: readonly string[];
  readonly type: string;
  readonly reason: string;
}

export function validateInterface(iface: Interface): readonly InterfaceProblem[] {
  const problems: InterfaceProblem[] = [];
  const records = new Map<string, CStruct>();
  const seen = new Set<string>();
  const seenReserved = new Set<string>();
  for (const cstruct of iface.cstructs) {
    if (isPrimitive(cstruct.name)) {
      if (!seenReserved.has(cstruct.name)) {
        seenReserved.add(cstruct.name);
        problems.push({
          kind: "reserved",
          symbol: cstruct.name,
          position: "declaration",
          path: [],
          type: cstruct.name,
          reason: `@cstruct name collides with the built-in type '${cstruct.name}'`,
        });
      }
      continue;
    }
    if (records.has(cstruct.name)) {
      if (!seen.has(cstruct.name)) {
        seen.add(cstruct.name);
        problems.push({
          kind: "duplicate",
          symbol: cstruct.name,
          position: "declaration",
          path: [],
          type: cstruct.name,
          reason: "@cstruct record is declared more than once",
        });
      }
      continue;
    }
    records.set(cstruct.name, cstruct);
  }

  for (const cstruct of records.values()) {
    for (const field of cstruct.fields) {
      checkType(records, field.type, cstruct.name, "field", [field.name], problems);
    }
  }

  const funcNames = new Set<string>();
  const seenFuncDuplicates = new Set<string>();
  const firstFuncs = new Map<string, ExternFunc>();
  const foreign = iface.kind === "foreign";
  for (const func of iface.funcs) {
    if (funcNames.has(func.name)) {
      if (!seenFuncDuplicates.has(func.name)) {
        seenFuncDuplicates.add(func.name);
        problems.push({
          kind: "duplicate",
          symbol: func.name,
          position: "declaration",
          path: [],
          type: func.name,
          reason: "extern function is declared more than once",
        });
      }
      continue;
    }
    funcNames.add(func.name);
    firstFuncs.set(func.name, func);
    for (const param of func.params) {
      checkType(records, param.type, func.name, "param", [param.name], problems);
      if (param.mutable && param.transfer) {
        problems.push({
          kind: "ownership",
          symbol: func.name,
          position: "param",
          path: [param.name],
          type: renderXzType(param.type),
          reason:
            "'mut' and 'transfer' are both C ABI ownership declarations and cannot be combined on one parameter",
        });
      } else if (param.transfer) {
        if (foreign) {
          checkTransfer(records, param.type, func.name, "param", [param.name], problems);
        } else {
          problems.push({
            kind: "ownership",
            symbol: func.name,
            position: "param",
            path: [param.name],
            type: renderXzType(param.type),
            reason:
              "'transfer' is a C ABI ownership declaration and cannot cross an Xz '@export' boundary; declare it only on an '@interface foreign'",
          });
        }
      }
    }
    const returnRepresentable = checkType(records, func.returnType, func.name, "return", [], problems);
    if (func.transferReturn) {
      if (foreign) {
        if (returnRepresentable) {
          checkTransfer(records, func.returnType, func.name, "return", [], problems);
        }
      } else {
        problems.push({
          kind: "ownership",
          symbol: func.name,
          position: "return",
          path: [],
          type: renderXzType(func.returnType),
          reason:
            "a 'transfer' return is a C ABI ownership declaration and cannot cross an Xz '@export' boundary; declare it only on an '@interface foreign'",
        });
      }
    }
  }

  for (const func of firstFuncs.values()) {
    if (foreign || (func.release !== undefined && !func.transferReturn)) {
      checkRelease(firstFuncs, records, func, problems);
    }
  }

  for (const cycle of findCycles(records)) {
    problems.push({
      kind: "cycle",
      symbol: cycle[0]!,
      position: "field",
      path: [],
      type: cycle.join(" -> "),
      reason: "@cstruct records must not form a cycle",
    });
  }

  return problems;
}

export function formatInterfaceProblem(problem: InterfaceProblem): string {
  const head = `symbol '${problem.symbol}'`;
  if (problem.kind === "cycle") {
    return `${head}: ${problem.reason} (${problem.type})`;
  }
  if (problem.kind === "duplicate" || problem.kind === "reserved") {
    return `${head}: ${problem.reason}`;
  }
  if (problem.kind === "ownership") {
    const location =
      problem.position === "return" ? "return type" : `parameter '${problem.path.join(".")}'`;
    return `${head}: ${location} of type '${problem.type}': ${problem.reason}`;
  }
  if (problem.kind === "release") {
    return `${head}: ${problem.reason}`;
  }
  const location =
    problem.position === "return"
      ? `return type '${problem.type}'`
      : `${problem.position === "param" ? "parameter" : "field"} '${problem.path.join(".")}' type '${problem.type}'`;
  return `${head}: ${location} is not C-representable: ${problem.reason}`;
}

function checkType(
  records: ReadonlyMap<string, CStruct>,
  type: XzType,
  symbol: string,
  position: ValidationPosition,
  path: readonly string[],
  problems: InterfaceProblem[],
): boolean {
  if (type.kind === "generic") {
    problems.push({
      kind: "generic",
      symbol,
      position,
      path,
      type: renderXzType(type),
      reason: `generic type '${type.name}' has no C declaration`,
    });
    return false;
  }
  if (isPrimitive(type.name)) {
    if (type.name === "Unit" && position !== "return") {
      problems.push({
        kind: "unit",
        symbol,
        position,
        path,
        type: type.name,
        reason: "Unit is allowed only as a return type",
      });
      return false;
    }
    return true;
  }
  if (!records.has(type.name)) {
    problems.push({
      kind: "unknown",
      symbol,
      position,
      path,
      type: type.name,
      reason: `unknown type '${type.name}'; declare it as a @cstruct record or use a C-representable primitive`,
    });
    return false;
  }
  return true;
}

function checkTransfer(
  records: ReadonlyMap<string, CStruct>,
  type: XzType,
  symbol: string,
  position: ValidationPosition,
  path: readonly string[],
  problems: InterfaceProblem[],
): void {
  if (isPointerCarrying(type, records)) {
    return;
  }
  problems.push({
    kind: "ownership",
    symbol,
    position,
    path,
    type: renderXzType(type),
    reason: "'transfer' requires a pointer-carrying type (Str, Bytes, Ptr, or a @cstruct with a Ptr field)",
  });
}

function checkRelease(
  funcs: ReadonlyMap<string, ExternFunc>,
  records: ReadonlyMap<string, CStruct>,
  func: ExternFunc,
  problems: InterfaceProblem[],
): void {
  if (!func.transferReturn) {
    if (func.release !== undefined) {
      problems.push({
        kind: "release",
        symbol: func.name,
        position: "return",
        path: [],
        type: renderXzType(func.returnType),
        reason: "'release' names a deallocator for a 'transfer' return, but this return is not 'transfer'",
      });
    }
    return;
  }
  if (!isPointerCarrying(func.returnType, records)) {
    return;
  }
  if (func.release === undefined) {
    problems.push({
      kind: "release",
      symbol: func.name,
      position: "return",
      path: [],
      type: renderXzType(func.returnType),
      reason:
        "a 'transfer' return must declare its deallocator with 'release <symbol>' so the binding can free the buffer",
    });
    return;
  }
  if (func.release === func.name) {
    problems.push({
      kind: "release",
      symbol: func.name,
      position: "return",
      path: [],
      type: func.release,
      reason: "a function cannot release its own returned buffer",
    });
    return;
  }
  const release = funcs.get(func.release);
  if (release === undefined) {
    problems.push({
      kind: "release",
      symbol: func.name,
      position: "return",
      path: [],
      type: func.release,
      reason: `'release' names '${func.release}', which is not an 'extern func' declared in this interface`,
    });
    return;
  }
  if (!isReleaseSignature(release)) {
    problems.push({
      kind: "release",
      symbol: func.name,
      position: "return",
      path: [],
      type: func.release,
      reason: `release symbol '${func.release}' must be declared as 'func(ptr: Ptr) -> Unit' with one borrowed pointer parameter`,
    });
  }
}

function isReleaseSignature(release: ExternFunc): boolean {
  if (release.params.length !== 1) {
    return false;
  }
  const param = release.params[0]!;
  return (
    !param.mutable &&
    !param.transfer &&
    param.type.kind === "named" &&
    param.type.name === "Ptr" &&
    release.returnType.kind === "named" &&
    release.returnType.name === "Unit"
  );
}

function isPointerCarrying(
  type: XzType,
  records: ReadonlyMap<string, CStruct>,
  seen: Set<string> = new Set(),
): boolean {
  if (type.kind === "generic") {
    return false;
  }
  if (type.name === "Str" || type.name === "Bytes" || type.name === "Ptr") {
    return true;
  }
  const record = records.get(type.name);
  if (record === undefined || seen.has(type.name)) {
    return false;
  }
  seen.add(type.name);
  return record.fields.some((field) => isPointerCarrying(field.type, records, seen));
}

function findCycles(records: ReadonlyMap<string, CStruct>): readonly (readonly string[])[] {
  const cycles: string[][] = [];
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const seen = new Set<string>();

  const visit = (name: string): void => {
    const record = records.get(name);
    if (record === undefined || state.get(name) === "done") {
      return;
    }
    if (state.get(name) === "visiting") {
      const start = stack.indexOf(name);
      const cycle = stack.slice(start).concat(name);
      const key = [...cycle].sort().join("\u0000");
      if (!seen.has(key)) {
        seen.add(key);
        cycles.push(cycle);
      }
      return;
    }
    state.set(name, "visiting");
    stack.push(name);
    for (const field of record.fields) {
      if (field.type.kind === "named") {
        visit(field.type.name);
      }
    }
    stack.pop();
    state.set(name, "done");
  };

  for (const name of records.keys()) {
    visit(name);
  }
  return cycles;
}