import type {
  CachedTranscriptSegment,
  ExportFormat,
  LearningSettings,
  SaveWordPayload,
  VocabEntry
} from "~types"
import type { CurrentCaptionTrack } from "~lib/transcript/types"

export type Message =
  | { type: "GET_TRANSCRIPT"; payload: { videoId: string; trackUrl: string } }
  | { type: "SAVE_WORD"; payload: SaveWordPayload }
  | { type: "GET_RECENT_VOCAB"; payload: { limit: number; videoId?: string } }
  | { type: "EXPORT_VOCAB"; payload: { format: ExportFormat; videoId?: string } }
  | { type: "GET_SETTINGS"; payload: Record<string, never> }
  | { type: "SAVE_SETTINGS"; payload: Partial<LearningSettings> }
  | { type: "CLEAR_TRANSLATION_CACHE"; payload: Record<string, never> }
  | {
      type: "GET_WORD_TRANSLATION"
      payload: { word: string; contextText?: string }
    }
  | {
      type: "PREWARM_WORD_TRANSLATIONS"
      payload: {
        words: string[]
        maxWords?: number
        maxOnlineWords?: number
        waitForOnline?: boolean
      }
    }
  | { type: "OPEN_VOCAB_TAB"; payload: { videoId?: string } }
  | { type: "OPEN_SETTINGS_TAB"; payload: Record<string, never> }
  | { type: "MAIN_WORLD_GET_PLAYER_RESPONSE"; payload: Record<string, never> }
  | { type: "MAIN_WORLD_FETCH_TEXT"; payload: { url: string } }
  | { type: "MAIN_WORLD_GET_TRANSCRIPT_API"; payload: { videoId: string } }
  | {
      type: "MAIN_WORLD_GET_CURRENT_CAPTION_TRACK"
      payload: { videoId: string }
    }
  | {
      type: "MAIN_WORLD_GET_PLAYER_CAPTION_URL"
      payload: { videoId: string; languageCode: string; kind?: string }
    }

export type MessageResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export type GetTranscriptResponse = {
  segments: CachedTranscriptSegment[] | null
}

export type SaveWordResponse = {
  entry: VocabEntry
}

export type ExportVocabResponse = {
  filename: string
  mimeType: string
  content: string
}

export type WordTranslationResponse = {
  word: string
  normalizedWord: string
  briefMeaning: string
  source: "cache" | "local" | "online" | "fallback"
}

export type PrewarmWordTranslationsResponse = {
  requested: number
  local: number
  cache: number
  online: number
  failed: number
  ready: number
  cachedOrLocal: number
  queuedOnline: number
  skippedOnline: number
}

export type ClearTranslationCacheResponse = {
  cleared: true
}

export type MainWorldFetchTextResponse = {
  text: string
}

export type MainWorldTranscriptResponse = {
  segments: CachedTranscriptSegment[] | null
}

export type MainWorldPlayerCaptionUrlResponse = {
  url: string | null
}

export type MainWorldCurrentCaptionTrackResponse = {
  track: CurrentCaptionTrack | null
  url: string | null
}

export const sendRuntimeMessage = async <T>(
  message: Message,
  timeoutMs = 15000
): Promise<MessageResponse<T>> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  try {
    const response = await Promise.race([
      chrome.runtime.sendMessage(message),
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), timeoutMs)
      })
    ])
    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    if (!response) {
      return {
        ok: false,
        error: `Runtime message ${message.type} timed out or returned empty.`
      }
    }

    return response as MessageResponse<T>
  } catch (error) {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    const reason =
      error instanceof Error ? error.message : "Failed to send runtime message."
    return { ok: false, error: reason }
  }
}
