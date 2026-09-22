import type { AgentStatus, RunAgentResult } from "./run.js";

export type AgentOutcome = "first-pass" | "self-corrected" | "escalated";

export interface RunMetrics {
  readonly outcome: AgentOutcome;
  readonly status: AgentStatus;
  readonly attempts: number;
  readonly firstPass: boolean;
  readonly selfCorrected: boolean;
  readonly escalated: boolean;
}

export interface KpiSummary {
  readonly runs: number;
  readonly firstPass: number;
  readonly selfCorrected: number;
  readonly escalated: number;
  readonly firstPassRate: number;
  readonly selfCorrectionRate: number;
  readonly escalationRate: number;
}

export function classifyOutcome(status: AgentStatus, attempts: number): AgentOutcome {
  if (status === "escalated") {
    return "escalated";
  }
  return attempts === 1 ? "first-pass" : "self-corrected";
}

export function computeRunMetrics(
  result: Pick<RunAgentResult, "status" | "attempts">,
): RunMetrics {
  const outcome = classifyOutcome(result.status, result.attempts);
  return {
    outcome,
    status: result.status,
    attempts: result.attempts,
    firstPass: outcome === "first-pass",
    selfCorrected: outcome === "self-corrected",
    escalated: outcome === "escalated",
  };
}

export function summarizeKpis(runs: readonly RunMetrics[]): KpiSummary {
  let firstPass = 0;
  let selfCorrected = 0;
  let escalated = 0;
  for (const run of runs) {
    if (run.firstPass) {
      firstPass += 1;
    }
    if (run.selfCorrected) {
      selfCorrected += 1;
    }
    if (run.escalated) {
      escalated += 1;
    }
  }
  const recoverable = selfCorrected + escalated;
  return {
    runs: runs.length,
    firstPass,
    selfCorrected,
    escalated,
    firstPassRate: rate(firstPass, runs.length),
    selfCorrectionRate: rate(selfCorrected, recoverable),
    escalationRate: rate(escalated, runs.length),
  };
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}