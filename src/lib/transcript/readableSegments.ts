import type { CachedTranscriptSegment } from "~types"

const MAX_BLOCK_CHARS = 84
const MIN_BLOCK_CHARS = 34
const MAX_BLOCK_SECONDS = 7.5
const MAX_MERGE_GAP_SECONDS = 1.15
const MAX_SHORT_LEAD_CHARS = 16
const MAX_SHORT_LEAD_WORDS = 2
const MAX_INCOMPLETE_BLOCK_CHARS = 46
const HARD_END_PATTERN = /[.!?]["')\]]?$/
const INCOMPLETE_END_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "for",
  "from",
  "in",
  "into",
  "is",
  "of",
  "on",
  "or",
  "that",
  "the",
  "these",
  "this",
  "to",
  "with"
])

const normalizeText = (text: string): string => {
  return text.replace(/\s+/g, " ").trim()
}

const splitWords = (text: string): string[] => {
  return normalizeText(text).split(/\s+/).filter(Boolean)
}

const sameWord = (left: string, right: string): boolean => {
  return left.toLowerCase() === right.toLowerCase()
}

type MergeAnalysis = {
  kind: "replace-right" | "keep-left" | "overlap" | "append"
  text: string
}

const analyzeMerge = (left: string, right: string): MergeAnalysis => {
  const cleanLeft = normalizeText(left)
  const cleanRight = normalizeText(right)

  if (!cleanLeft) {
    return { kind: "replace-right", text: cleanRight }
  }
  if (!cleanRight) {
    return { kind: "keep-left", text: cleanLeft }
  }

  const lowerLeft = cleanLeft.toLowerCase()
  const lowerRight = cleanRight.toLowerCase()

  if (lowerRight.startsWith(`${lowerLeft} `) || lowerRight === lowerLeft) {
    return { kind: "replace-right", text: cleanRight }
  }
  if (lowerLeft.endsWith(` ${lowerRight}`) || lowerLeft === lowerRight) {
    return { kind: "keep-left", text: cleanLeft }
  }

  const leftWords = splitWords(cleanLeft)
  const rightWords = splitWords(cleanRight)
  const maxOverlap = Math.min(leftWords.length, rightWords.length, 8)

  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const leftTail = leftWords.slice(leftWords.length - overlap)
    const rightHead = rightWords.slice(0, overlap)
    if (leftTail.every((word, index) => sameWord(word, rightHead[index]))) {
      return {
        kind: "overlap",
        text: [...leftWords, ...rightWords.slice(overlap)].join(" ")
      }
    }
  }

  return {
    kind: "append",
    text: `${cleanLeft} ${cleanRight}`
  }
}

const isShortLeadFragment = (text: string): boolean => {
  const normalized = normalizeText(text)
  if (!normalized) {
    return true
  }

  return (
    normalized.length <= MAX_SHORT_LEAD_CHARS ||
    splitWords(normalized).length <= MAX_SHORT_LEAD_WORDS
  )
}

const endsWithIncompleteWord = (text: string): boolean => {
  const words = splitWords(text)
  const lastWord = words.at(-1)?.toLowerCase()
  return lastWord ? INCOMPLETE_END_WORDS.has(lastWord) : false
}

const isFragmentedTranscript = (segments: CachedTranscriptSegment[]): boolean => {
  if (segments.length < 4) {
    return false
  }

  const shortSegments = segments.filter((segment) => {
    const text = normalizeText(segment.text)
    const wordCount = splitWords(text).length
    return text.length <= 28 || wordCount <= 5
  })

  return shortSegments.length / segments.length >= 0.35
}

export const createReadableCaptionSegments = (
  segments: CachedTranscriptSegment[],
  force = false
): CachedTranscriptSegment[] => {
  const cleaned = segments
    .map((segment) => ({
      ...segment,
      text: normalizeText(segment.text)
    }))
    .filter((segment) => segment.text)
    .sort((left, right) => left.start - right.start)

  if (!force && !isFragmentedTranscript(cleaned)) {
    return cleaned
  }

  const output: CachedTranscriptSegment[] = []
  let current: CachedTranscriptSegment | null = null

  for (const segment of cleaned) {
    if (!current) {
      current = segment
      continue
    }

    const gap = Math.max(0, segment.start - current.end)
    const mergeAnalysis = analyzeMerge(current.text, segment.text)
    const mergedText = mergeAnalysis.text
    const duration = Math.max(segment.end, current.end) - current.start
    const canMergeIncompleteTail =
      current.text.length < MAX_INCOMPLETE_BLOCK_CHARS &&
      endsWithIncompleteWord(current.text)
    const canMergeByRelationship =
      mergeAnalysis.kind !== "append" ||
      isShortLeadFragment(current.text) ||
      canMergeIncompleteTail
    const shouldBreak =
      gap > MAX_MERGE_GAP_SECONDS ||
      !canMergeByRelationship ||
      (HARD_END_PATTERN.test(current.text) && current.text.length >= MIN_BLOCK_CHARS) ||
      (mergedText.length > MAX_BLOCK_CHARS && current.text.length >= MIN_BLOCK_CHARS) ||
      (duration > MAX_BLOCK_SECONDS && current.text.length >= MIN_BLOCK_CHARS)

    if (shouldBreak) {
      output.push(current)
      current = segment
      continue
    }

    current = {
      start: current.start,
      end: Math.max(current.end, segment.end),
      text: mergedText
    }
  }

  if (current) {
    output.push(current)
  }

  return output
}
