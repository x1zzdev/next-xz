export type EffectLabel = "none" | "mut" | "io" | "chan" | "extern";

export type EffectBadge =
  | "PURE"
  | "MUTATES_STATE"
  | "IO"
  | "CONCURRENCY"
  | "EXTERNAL_FFI";

export type BadgeColor = "green" | "amber" | "blue" | "purple" | "red";

export interface EffectBadgeView {
  readonly label: EffectLabel;
  readonly badge: EffectBadge;
  readonly color: BadgeColor;
}

export const EFFECT_LABELS: readonly EffectLabel[] = [
  "none",
  "mut",
  "io",
  "chan",
  "extern",
];

const BADGE_TABLE: Readonly<
  Record<EffectLabel, { readonly badge: EffectBadge; readonly color: BadgeColor }>
> = {
  none: { badge: "PURE", color: "green" },
  mut: { badge: "MUTATES_STATE", color: "amber" },
  io: { badge: "IO", color: "blue" },
  chan: { badge: "CONCURRENCY", color: "purple" },
  extern: { badge: "EXTERNAL_FFI", color: "red" },
};

export function isEffectLabel(value: string): value is EffectLabel {
  return (EFFECT_LABELS as readonly string[]).includes(value);
}

export function effectBadges(effects: readonly EffectLabel[]): EffectBadgeView[] {
  const present = new Set(effects);
  return EFFECT_LABELS.filter((label) => present.has(label)).map((label) => ({
    label,
    ...BADGE_TABLE[label],
  }));
}
