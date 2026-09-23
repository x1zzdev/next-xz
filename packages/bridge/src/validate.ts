import { isPrimitive, renderXzType } from "./type-map.js";
import type { CStruct, Interface, XzType } from "./xzint/ast.js";

export type ValidationPosition = "param" | "return" | "field" | "declaration";

export type InterfaceProblemKind =
  | "generic"
  | "unit"
  | "unknown"
  | "cycle"
  | "duplicate"
  | "reserved";

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
    for (const param of func.params) {
      checkType(records, param.type, func.name, "param", [param.name], problems);
    }
    checkType(records, func.returnType, func.name, "return", [], problems);
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
): void {
  if (type.kind === "generic") {
    problems.push({
      kind: "generic",
      symbol,
      position,
      path,
      type: renderXzType(type),
      reason: `generic type '${type.name}' has no C declaration`,
    });
    return;
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
    }
    return;
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
  }
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