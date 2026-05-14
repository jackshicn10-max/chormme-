import type { CachedTranscriptSegment } from "~types"

type Json3Segment = {
  utf8?: string
}

type Json3Event = {
  tStartMs?: number
  dDurationMs?: number
  segs?: Json3Segment[]
}

type Json3Transcript = {
  events?: Json3Event[]
}

const normalizeText = (text: string): string => {
  return text.replace(/\s+/g, " ").trim()
}

export const parseJson3Transcript = (
  input: unknown
): CachedTranscriptSegment[] => {
  const data = input as Json3Transcript
  if (!Array.isArray(data?.events)) {
    return []
  }

  const parsed: CachedTranscriptSegment[] = []

  for (const event of data.events) {
    const startMs = event.tStartMs
    if (typeof startMs !== "number") {
      continue
    }

    const rawText = Array.isArray(event.segs)
      ? event.segs.map((segment) => segment.utf8 ?? "").join("")
      : ""
    const text = normalizeText(rawText)

    if (!text) {
      continue
    }

    const durationMs = typeof event.dDurationMs === "number" ? event.dDurationMs : 0
    const start = Math.max(0, startMs / 1000)
    const end = Math.max(start + 0.05, (startMs + durationMs) / 1000)

    parsed.push({
      start,
      end,
      text
    })
  }

  return parsed
}

