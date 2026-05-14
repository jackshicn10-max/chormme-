import type { VocabEntry } from "~types"

export const buildJson = (entries: VocabEntry[]): string => {
  return JSON.stringify(entries, null, 2)
}

