import type { CachedTranscriptSegment } from "~types"
import type { CurrentCaptionTrack } from "~lib/transcript/types"

import type {
  MainWorldCurrentCaptionTrackResponse,
  MainWorldFetchTextResponse,
  MainWorldPlayerCaptionUrlResponse,
  MainWorldTranscriptResponse
} from "./messages"
import { sendRuntimeMessage } from "./messages"

type MainRequestAction =
  | "GET_PLAYER_RESPONSE"
  | "FETCH_TEXT"
  | "GET_TRANSCRIPT_FROM_API"
  | "GET_CURRENT_CAPTION_TRACK"
  | "GET_PLAYER_CAPTION_URL"

export const requestMainWorld = async <T>(
  action: MainRequestAction,
  payload?: Record<string, unknown>
): Promise<T> => {
  if (action === "GET_PLAYER_RESPONSE") {
    const response = await sendRuntimeMessage<unknown>({
      type: "MAIN_WORLD_GET_PLAYER_RESPONSE",
      payload: {}
    }, 8000)
    if (!response.ok) {
      throw new Error(
        "error" in response
          ? response.error
          : "MAIN_WORLD_GET_PLAYER_RESPONSE failed."
      )
    }
    return response.data as T
  }

  if (action === "FETCH_TEXT") {
    const url = payload?.url
    if (typeof url !== "string" || !url) {
      throw new Error("FETCH_TEXT requires a valid url.")
    }

    const response = await sendRuntimeMessage<MainWorldFetchTextResponse>({
      type: "MAIN_WORLD_FETCH_TEXT",
      payload: { url }
    }, 8000)
    if (!response.ok) {
      throw new Error(
        "error" in response ? response.error : "MAIN_WORLD_FETCH_TEXT failed."
      )
    }

    return response.data.text as T
  }

  if (action === "GET_TRANSCRIPT_FROM_API") {
    const videoId = payload?.videoId
    if (typeof videoId !== "string" || !videoId) {
      throw new Error("GET_TRANSCRIPT_FROM_API requires videoId.")
    }

    const response = await sendRuntimeMessage<MainWorldTranscriptResponse>({
      type: "MAIN_WORLD_GET_TRANSCRIPT_API",
      payload: { videoId }
    }, 10000)
    if (!response.ok) {
      throw new Error(
        "error" in response
          ? response.error
          : "MAIN_WORLD_GET_TRANSCRIPT_API failed."
      )
    }

    return response.data.segments as T
  }

  if (action === "GET_PLAYER_CAPTION_URL") {
    const videoId = payload?.videoId
    const languageCode = payload?.languageCode
    const kind = payload?.kind
    if (typeof videoId !== "string" || !videoId) {
      throw new Error("GET_PLAYER_CAPTION_URL requires videoId.")
    }
    if (typeof languageCode !== "string" || !languageCode) {
      throw new Error("GET_PLAYER_CAPTION_URL requires languageCode.")
    }

    const response =
      await sendRuntimeMessage<MainWorldPlayerCaptionUrlResponse>({
        type: "MAIN_WORLD_GET_PLAYER_CAPTION_URL",
        payload: {
          videoId,
          languageCode,
          kind: typeof kind === "string" ? kind : undefined
        }
      }, 12000)
    if (!response.ok) {
      throw new Error(
        "error" in response
          ? response.error
          : "MAIN_WORLD_GET_PLAYER_CAPTION_URL failed."
      )
    }

    return response.data.url as T
  }

  if (action === "GET_CURRENT_CAPTION_TRACK") {
    const videoId = payload?.videoId
    if (typeof videoId !== "string" || !videoId) {
      throw new Error("GET_CURRENT_CAPTION_TRACK requires videoId.")
    }

    const response =
      await sendRuntimeMessage<MainWorldCurrentCaptionTrackResponse>({
        type: "MAIN_WORLD_GET_CURRENT_CAPTION_TRACK",
        payload: { videoId }
      }, 8000)
    if (!response.ok) {
      throw new Error(
        "error" in response
          ? response.error
          : "MAIN_WORLD_GET_CURRENT_CAPTION_TRACK failed."
      )
    }

    return response.data as T
  }

  throw new Error("Unsupported main-world request action.")
}

export const requestTranscriptFromApi = async (
  videoId: string
): Promise<CachedTranscriptSegment[] | null> => {
  try {
    const result = await requestMainWorld<CachedTranscriptSegment[] | null>(
      "GET_TRANSCRIPT_FROM_API",
      { videoId }
    )
    return Array.isArray(result) ? result : null
  } catch {
    return null
  }
}

export const requestPlayerCaptionUrl = async (
  videoId: string,
  languageCode: string,
  kind?: string
): Promise<string | null> => {
  try {
    const result = await requestMainWorld<string | null>(
      "GET_PLAYER_CAPTION_URL",
      { videoId, languageCode, kind }
    )
    return typeof result === "string" && result ? result : null
  } catch {
    return null
  }
}

export const requestCurrentCaptionTrack = async (
  videoId: string
): Promise<MainWorldCurrentCaptionTrackResponse | null> => {
  try {
    const result = await requestMainWorld<MainWorldCurrentCaptionTrackResponse>(
      "GET_CURRENT_CAPTION_TRACK",
      { videoId }
    )
    return result
  } catch {
    return null
  }
}
