export type {
  CachedTranscriptSegment,
  TranscriptSegment,
  WordToken
} from "~types"

export type CaptionTrack = {
  baseUrl: string
  languageCode: string
  kind?: string
  vssId?: string
}

export type CurrentCaptionTrack = {
  baseUrl?: string | null
  languageCode?: string | null
  kind?: string | null
  url?: string | null
  vssId?: string | null
}
