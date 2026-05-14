import type { CachedTranscriptSegment, TranscriptSegment, WordToken } from "~types"

const WORD_PATTERN = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g

export const normalizeWord = (input: string): string => {
  return input.replace(/[’]/g, "'").toLowerCase()
}

export const tokenizeSegmentText = (
  segmentId: string,
  text: string
): WordToken[] => {
  const matches = text.match(WORD_PATTERN) ?? []

  return matches.map((surface, index) => {
    return {
      id: `${segmentId}-token-${index}`,
      surface,
      normalized: normalizeWord(surface),
      indexInSegment: index
    }
  })
}

export const withRuntimeTokens = (
  segments: CachedTranscriptSegment[]
): TranscriptSegment[] => {
  return segments.map((segment, index) => {
    const id = `seg-${index}`
    return {
      ...segment,
      id,
      tokens: tokenizeSegmentText(id, segment.text)
    }
  })
}

