import type { Diagnostic } from "@xz-lang/agent";

import type { EffectLabel } from "./effects.js";
import { extractDocClaims, extractSignature, type TrustedClaim } from "./extract.js";

export type AuditStatus = "pending" | "approved" | "rejected" | "blocked";

export interface AuditCard {
  readonly module: string;
  readonly signature: string;
  readonly intent: string;
  readonly declaredEffects: readonly EffectLabel[];
  readonly derivedEffects: readonly EffectLabel[];
  readonly trustedClaims: readonly TrustedClaim[];
  readonly diagnostics: readonly Diagnostic[];
  readonly diff: string;
  readonly status: AuditStatus;
}

export interface AuditCardInput {
  readonly module: string;
  readonly source: string;
  readonly diagnostics?: readonly Diagnostic[];
  readonly diff?: string;
  readonly derivedEffects?: readonly EffectLabel[];
  readonly status?: AuditStatus;
}

export function buildAuditCard(input: AuditCardInput): AuditCard {
  const claims = extractDocClaims(input.source);
  return {
    module: input.module,
    signature: extractSignature(input.source),
    intent: claims.intent,
    declaredEffects: claims.declaredEffects,
    derivedEffects: input.derivedEffects ?? [],
    trustedClaims: claims.trustedClaims,
    diagnostics: input.diagnostics ?? [],
    diff: input.diff ?? "",
    status: input.status ?? "pending",
  };
}
