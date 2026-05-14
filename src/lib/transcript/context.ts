import type { TranscriptSegment, TranscriptWindow } from "~types"

const CONTEXT_RADIUS = 2

const compact = (rows: string[]): string[] => {
  return rows.map((row) => row.trim()).filter(Boolean)
}

export const buildTranscriptWindow = (
  segments: TranscriptSegment[],
  segmentIndex: number
): TranscriptWindow => {
  const current = segments[segmentIndex]
  const start = Math.max(0, segmentIndex - CONTEXT_RADIUS)
  const end = Math.min(segments.length - 1, segmentIndex + CONTEXT_RADIUS)

  const before = compact(segments.slice(start, segmentIndex).map((item) => item.text))
  const after = compact(
    segments.slice(segmentIndex + 1, end + 1).map((item) => item.text)
  )
  const sentence = current?.text?.trim() ?? ""

  const contextText = compact([...before, sentence, ...after]).join(" ")

  return {
    sentence,
    before,
    after,
    contextText
  }
}

