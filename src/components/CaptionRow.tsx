import { WordToken } from "~components/WordToken"
import type { TranscriptSegment, WordToken as WordTokenType } from "~types"

const WORD_PATTERN = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/

type CaptionRowProps = {
  segment: TranscriptSegment
  active: boolean
  savedWords: Set<string>
  translationEnabled: boolean
  onSeek: (segment: TranscriptSegment) => void
  onSaveWord: (token: WordTokenType, segment: TranscriptSegment) => void
  rowRef?: (node: HTMLDivElement | null) => void
}

export const CaptionRow = ({
  segment,
  active,
  savedWords,
  translationEnabled,
  onSeek,
  onSaveWord,
  rowRef
}: CaptionRowProps) => {
  let tokenCursor = 0
  const parts = segment.text.split(/([A-Za-z]+(?:['’-][A-Za-z]+)*)/g)

  return (
    <div
      ref={rowRef}
      onClick={() => onSeek(segment)}
      style={{
        borderRadius: 8,
        padding: "8px 10px",
        marginBottom: 6,
        cursor: "pointer",
        lineHeight: 1.45,
        background: active ? "rgba(59, 130, 246, 0.16)" : "transparent",
        border: active ? "1px solid rgba(37, 99, 235, 0.35)" : "1px solid transparent"
      }}>
      {parts.map((part, index) => {
        if (!part) {
          return null
        }

        if (!WORD_PATTERN.test(part)) {
          return <span key={`txt-${segment.id}-${index}`}>{part}</span>
        }

        const token = segment.tokens[tokenCursor]
        tokenCursor += 1
        if (!token) {
          return <span key={`missing-${segment.id}-${index}`}>{part}</span>
        }

        return (
          <WordToken
            key={token.id}
            token={token}
            isSaved={savedWords.has(token.normalized)}
            translationEnabled={translationEnabled}
            onSave={(nextToken) => onSaveWord(nextToken, segment)}
          />
        )
      })}
    </div>
  )
}
