/**
 * FSRS v5 published default weights (19 values, w[0]..w[18]).
 * Source: https://github.com/open-spaced-repetition/fsrs5
 */
export const DEFAULT_W: readonly number[] = [
  0.40255, 1.18385, 3.1262, 15.4722, 7.2102,
  0.5316, 1.0651, 0.06069, 1.39974, 0.14268,
  1.05171, 1.93327, 0.11540, 0.29605, 2.2700,
  0.079, 2.9898, 0.44658, 0.9946,
]

/** Default deck parameters */
export const DEFAULT_PARAMS = {
  requestRetention: 0.9,
  maximumInterval: 36500,
  w: [] as number[],
  newCardsPerDay: 10,
}

/** FSRS grade values */
export const GRADE = {
  AGAIN: 1,
  HARD: 2,
  GOOD: 3,
  EASY: 4,
} as const
