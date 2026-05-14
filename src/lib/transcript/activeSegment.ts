import type { TranscriptSegment } from "~types"

const TRAILING_GRACE_SECONDS = 1.2

export const findActiveSegmentIndex = (
  segments: TranscriptSegment[],
  currentTime: number
): number => {
  let left = 0
  let right = segments.length - 1
  let candidate = -1

  while (left <= right) {
    const middle = Math.floor((left + right) / 2)
    const segment = segments[middle]

    if (segment.start <= currentTime) {
      candidate = middle
      left = middle + 1
      continue
    }

    right = middle - 1
  }

  if (candidate < 0) {
    return -1
  }

  const segment = segments[candidate]
  const next = segments[candidate + 1]

  if (!next && currentTime > segment.end + TRAILING_GRACE_SECONDS) {
    return -1
  }

  if (
    next &&
    currentTime > segment.end + TRAILING_GRACE_SECONDS &&
    currentTime < next.start
  ) {
    return -1
  }

  return candidate
}
