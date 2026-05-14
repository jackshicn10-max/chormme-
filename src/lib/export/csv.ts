import type { VocabEntry } from "~types"

const CSV_FIELDS = [
  "word",
  "normalizedWord",
  "briefMeaning",
  "sentence",
  "contextText",
  "videoId",
  "videoTitle",
  "videoUrl",
  "timestamp",
  "createdAt",
  "note"
] as const

const escapeCsv = (value: string): string => {
  if (value.includes('"') || value.includes(",") || value.includes("\n")) {
    return `"${value.replaceAll('"', '""')}"`
  }
  return value
}

export const buildCsv = (entries: VocabEntry[]): string => {
  const header = CSV_FIELDS.join(",")
  const rows = entries.map((entry) => {
    return CSV_FIELDS.map((field) => escapeCsv(String(entry[field] ?? ""))).join(",")
  })

  return `\uFEFF${[header, ...rows].join("\n")}`
}
