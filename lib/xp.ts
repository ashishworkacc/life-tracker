/** XP required to advance FROM level `n` to level `n+1` */
export function xpToNextLevel(level: number): number {
  return Math.round(200 * Math.pow(1.5, level - 1))
}

/**
 * Calculate level from cumulative total XP.
 * Level 1 = 0–199 XP, Level 2 = 200–499 XP, Level 3 = 500–1149 XP, etc.
 */
export function calcLevel(totalXP: number): number {
  let lvl = 1
  let accumulated = 0
  while (accumulated + xpToNextLevel(lvl) <= totalXP) {
    accumulated += xpToNextLevel(lvl)
    lvl++
  }
  return lvl
}

/** XP earned within the current level (progress toward next level) */
export function xpInCurrentLevel(totalXP: number): number {
  let lvl = 1
  let accumulated = 0
  while (accumulated + xpToNextLevel(lvl) <= totalXP) {
    accumulated += xpToNextLevel(lvl)
    lvl++
  }
  return totalXP - accumulated
}
