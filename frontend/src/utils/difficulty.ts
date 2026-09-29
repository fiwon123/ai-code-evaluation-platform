import type { BadgeVariant } from "../components/Badge/Badge.tsx";

/**
 * Difficulty identity: label, order, and colour, defined once.
 *
 * The `easy`/`medium`/`hard` → `success`/`warning`/`danger` mapping was written
 * out identically in `Challenges.tsx` and `ChallengeDetail.tsx`, and the
 * challenge form had its own separate copy of the *labels*. Three places to
 * keep in step, with nothing forcing them to agree — so difficulty colour lived
 * in two files and the chip labels in a third. It belongs next to
 * `LANGUAGE_META` in spirit: one source per badge vocabulary.
 */

export type ChallengeDifficulty = "easy" | "medium" | "hard";

export interface DifficultyOption {
  value: ChallengeDifficulty;
  label: string;
  /** Badge tint, reused from the shared `Badge` variants. */
  variant: BadgeVariant;
}

/** Declaration order is display order — easiest first. */
export const DIFFICULTIES: readonly DifficultyOption[] = [
  { value: "easy", label: "Easy", variant: "success" },
  { value: "medium", label: "Medium", variant: "warning" },
  { value: "hard", label: "Hard", variant: "danger" },
];

/** Difficulty → `Badge` variant, for the pages that render a lone pill. */
export const DIFFICULTY_VARIANT: Record<ChallengeDifficulty, BadgeVariant> =
  Object.fromEntries(
    DIFFICULTIES.map((d) => [d.value, d.variant]),
  ) as Record<ChallengeDifficulty, BadgeVariant>;

export function difficultyLabel(
  difficulty: string | null | undefined,
): string {
  if (!difficulty) return "Unknown";
  return (
    DIFFICULTIES.find((d) => d.value === difficulty)?.label ??
    // Capitalize an unrecognised value rather than dropping it, so an
    // unexpected backend value is still legible instead of blank.
    difficulty.charAt(0).toUpperCase() + difficulty.slice(1)
  );
}
