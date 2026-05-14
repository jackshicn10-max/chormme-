import { parseJson3Transcript } from "~lib/transcript/parseJson3"
import { parseXmlTranscript } from "~lib/transcript/parseXml"
import {
  requestPlayerCaptionUrl as requestMainWorldPlayerCaptionUrl,
  requestMainWorld,
  requestTranscriptFromApi
} from "~lib/mainWorldBridge"
import type { CachedTranscriptSegment } from "~types"

import type { CaptionTrack, CurrentCaptionTrack } from "./types"

type MaybeTrackPayload = {
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrack[]
    }
  }
}

const JSON3_FORMATS = ["json3", "srv3", "vtt"] as const
const PLAYER_CAPTION_WAIT_MS = 9000
const PLAYER_CAPTION_POLL_MS = 250

export const extractCaptionTracks = (playerResponse: unknown): CaptionTrack[] => {
  const payload = playerResponse as MaybeTrackPayload
  const tracks =
    payload?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
  return Array.isArray(tracks) ? tracks : []
}

const isEnglishCode = (code: string): boolean => {
  return code === "en" || code.startsWith("en-")
}

export const isPlayerBackedCaptionTrack = (track: CaptionTrack): boolean => {
  if (track.kind === "asr" || track.vssId?.startsWith("a.")) {
    return true
  }

  try {
    return new URL(track.baseUrl).searchParams.get("caps") === "asr"
  } catch {
    return false
  }
}

export const selectEnglishTrack = (
  tracks: CaptionTrack[]
): CaptionTrack | null => {
  return selectEnglishTracks(tracks)[0] ?? null
}

export const selectEnglishTracks = (
  tracks: CaptionTrack[]
): CaptionTrack[] => {
  if (!tracks.length) {
    return []
  }

  const validTracks = tracks.filter(
    (track) => typeof track.baseUrl === "string" && track.baseUrl.trim().length > 0
  )
  if (!validTracks.length) {
    return []
  }

  const rules: Array<(track: CaptionTrack) => boolean> = [
    (track) => track.languageCode === "en" && track.kind !== "asr",
    (track) => track.languageCode === "en" && track.kind === "asr",
    (track) => isEnglishCode(track.languageCode) && track.kind !== "asr",
    (track) => isEnglishCode(track.languageCode) && track.kind === "asr",
    (track) => isEnglishCode(track.languageCode)
  ]
  const selected: CaptionTrack[] = []
  const seen = new Set<string>()

  for (const rule of rules) {
    for (const track of validTracks.filter(rule)) {
      const key = track.baseUrl
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      selected.push(track)
    }
  }

  return selected
}

const normalizeTrackKind = (
  kind?: string | null,
  vssId?: string | null
): string | undefined => {
  if (kind) {
    return kind
  }
  if (vssId?.startsWith("a.")) {
    return "asr"
  }
  return undefined
}

export const createTrackFromTimedtextUrl = (
  urlText: string | null | undefined
): CaptionTrack | null => {
  if (!urlText) {
    return null
  }

  try {
    const url = new URL(urlText)
    if (!url.pathname.includes("/api/timedtext")) {
      return null
    }
    if (url.searchParams.has("tlang")) {
      return null
    }

    const languageCode = url.searchParams.get("lang") ?? ""
    if (!isEnglishCode(languageCode)) {
      return null
    }

    return {
      baseUrl: url.toString(),
      languageCode,
      kind:
        url.searchParams.get("kind") ??
        (url.searchParams.has("pot") || url.searchParams.get("caps") === "asr"
          ? "asr"
          : undefined)
    }
  } catch {
    return null
  }
}

export const selectCurrentCaptionTrack = (
  tracks: CaptionTrack[],
  current: CurrentCaptionTrack | null | undefined
): CaptionTrack | null => {
  if (!current) {
    return null
  }

  const fromUrl = createTrackFromTimedtextUrl(current.url ?? current.baseUrl)
  if (fromUrl) {
    return fromUrl
  }

  const languageCode = current.languageCode ?? ""
  if (!isEnglishCode(languageCode)) {
    return null
  }

  const kind = normalizeTrackKind(current.kind, current.vssId)
  const vssId = current.vssId ?? ""
  const validTracks = tracks.filter(
    (track) => typeof track.baseUrl === "string" && track.baseUrl.trim().length > 0
  )

  if (vssId) {
    const byVssId = validTracks.find((track) => track.vssId === vssId)
    if (byVssId) {
      return byVssId
    }
  }

  if (kind) {
    const byKind = validTracks.find(
      (track) => track.languageCode === languageCode && normalizeTrackKind(track.kind, track.vssId) === kind
    )
    if (byKind) {
      return byKind
    }
  }

  return (
    validTracks.find((track) => track.languageCode === languageCode) ??
    validTracks.find((track) => isEnglishCode(track.languageCode)) ??
    null
  )
}

const fetchText = async (url: string): Promise<string> => {
  const tryIsolatedFetch = async (): Promise<string | null> => {
    try {
      const response = await fetch(url, {
        credentials: "include",
        cache: "no-store"
      })
      if (!response.ok) {
        return null
      }
      const body = await response.text()
      return body.trim() ? body : null
    } catch {
      return null
    }
  }

  const tryMainFetch = async (): Promise<string | null> => {
    try {
      const body = await requestMainWorld<string>("FETCH_TEXT", { url })
      return typeof body === "string" && body.trim() ? body : null
    } catch {
      return null
    }
  }

  const isolatedBody = await tryIsolatedFetch()
  if (isolatedBody) {
    return isolatedBody
  }

  const mainBody = await tryMainFetch()
  if (mainBody) {
    return mainBody
  }

  throw new Error("Transcript response was empty.")
}

const toUrlWithFmt = (inputUrl: URL, fmt: string | null): string => {
  const url = new URL(inputUrl.toString())
  if (fmt) {
    url.searchParams.set("fmt", fmt)
  } else {
    url.searchParams.delete("fmt")
  }
  return url.toString()
}

const createSanitizedTimedtextUrl = (baseUrl: URL): URL => {
  const sanitized = new URL(baseUrl.toString())
  const blocked = ["signature", "sig", "lsig", "sparams", "expire", "ip", "ipbits"]
  for (const key of blocked) {
    sanitized.searchParams.delete(key)
  }
  return sanitized
}

const createMinimalTimedtextUrls = (
  baseUrl: URL,
  track: CaptionTrack
): string[] => {
  const videoId = baseUrl.searchParams.get("v")
  const languageCode = track.languageCode || baseUrl.searchParams.get("lang") || ""
  const kind = track.kind || baseUrl.searchParams.get("kind") || ""
  if (!videoId || !languageCode) {
    return []
  }

  const urls: string[] = []
  const make = (fmt: string | null) => {
    const url = new URL("https://www.youtube.com/api/timedtext")
    url.searchParams.set("v", videoId)
    url.searchParams.set("lang", languageCode)
    if (kind) {
      url.searchParams.set("kind", kind)
    }
    if (fmt) {
      url.searchParams.set("fmt", fmt)
    }
    urls.push(url.toString())
  }

  for (const fmt of JSON3_FORMATS) {
    make(fmt)
  }
  make(null)

  return urls
}

const collectCandidateUrls = (track: CaptionTrack): string[] => {
  const candidateUrls = new Set<string>()
  candidateUrls.add(track.baseUrl)

  let baseUrl: URL | null = null
  try {
    baseUrl = new URL(track.baseUrl)
  } catch {
    baseUrl = null
  }

  if (baseUrl) {
    for (const fmt of JSON3_FORMATS) {
      candidateUrls.add(toUrlWithFmt(baseUrl, fmt))
    }
    candidateUrls.add(toUrlWithFmt(baseUrl, null))

    const sanitized = createSanitizedTimedtextUrl(baseUrl)
    for (const fmt of JSON3_FORMATS) {
      candidateUrls.add(toUrlWithFmt(sanitized, fmt))
    }
    candidateUrls.add(toUrlWithFmt(sanitized, null))

    for (const url of createMinimalTimedtextUrls(baseUrl, track)) {
      candidateUrls.add(url)
    }
  }

  return Array.from(candidateUrls)
}

const parseTranscriptPayload = (payload: string): CachedTranscriptSegment[] => {
  if (payload.trim().startsWith("{")) {
    try {
      const fromJson3 = parseJson3Transcript(JSON.parse(payload))
      if (fromJson3.length > 0) {
        return fromJson3
      }
    } catch {
      // Try XML parser below.
    }
  }

  return parseXmlTranscript(payload)
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms))

const getTrackVideoId = (track: CaptionTrack): string => {
  try {
    return new URL(track.baseUrl).searchParams.get("v") ?? ""
  } catch {
    return ""
  }
}

const isMatchingPlayerJson3Url = (
  urlText: string,
  videoId: string,
  languageCode: string
): boolean => {
  try {
    const url = new URL(urlText)
    if (!url.pathname.includes("/api/timedtext")) {
      return false
    }
    if (url.searchParams.get("v") !== videoId) {
      return false
    }
    if (url.searchParams.get("fmt") !== "json3") {
      return false
    }
    if (!url.searchParams.has("pot")) {
      return false
    }
    if (url.searchParams.has("tlang")) {
      return false
    }

    const lang = url.searchParams.get("lang") ?? languageCode
    return isEnglishCode(lang)
  } catch {
    return false
  }
}

const findPlayerJson3CaptionUrl = (
  videoId: string,
  languageCode: string
): string | null => {
  const entries = performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((url) => isMatchingPlayerJson3Url(url, videoId, languageCode))

  return entries.at(-1) ?? null
}

const requestPlayerCaptionUrl = async (
  track: CaptionTrack
): Promise<string | null> => {
  const videoId = getTrackVideoId(track)
  if (!videoId) {
    return null
  }

  const existing = findPlayerJson3CaptionUrl(videoId, track.languageCode)
  if (existing) {
    return existing
  }

  const fromMainWorld = await requestMainWorldPlayerCaptionUrl(
    videoId,
    track.languageCode,
    track.kind
  )
  if (fromMainWorld) {
    return fromMainWorld
  }

  const startedAt = Date.now()
  let clicked = false

  while (Date.now() - startedAt < PLAYER_CAPTION_WAIT_MS) {
    const button = document.querySelector<HTMLButtonElement>(".ytp-subtitles-button")
    if (button && !clicked) {
      if (button.getAttribute("aria-pressed") !== "true") {
        button.click()
      }
      clicked = true
    }

    const url = findPlayerJson3CaptionUrl(videoId, track.languageCode)
    if (url) {
      return url
    }

    await sleep(PLAYER_CAPTION_POLL_MS)
  }

  return null
}

const fetchPlayerCaptionSegments = async (
  track: CaptionTrack
): Promise<CachedTranscriptSegment[] | null> => {
  const url = await requestPlayerCaptionUrl(track)
  if (!url) {
    return null
  }

  const payload = await fetchText(url)
  const parsed = parseTranscriptPayload(payload)
  return parsed.length > 0 ? parsed : null
}

export const fetchTranscriptSegments = async (
  track: CaptionTrack
): Promise<CachedTranscriptSegment[]> => {
  const videoId = getTrackVideoId(track)

  const fetchFromTranscriptApi = async () => {
    if (!videoId) {
      return null
    }

    const fromApi = await requestTranscriptFromApi(videoId)
    if (fromApi && fromApi.length > 0) {
      return fromApi
    }

    return null
  }

  const playerBackedTrack = isPlayerBackedCaptionTrack(track)

  if (playerBackedTrack) {
    const fromPlayer = await fetchPlayerCaptionSegments(track)
    if (fromPlayer) {
      return fromPlayer
    }

    const fromApi = await fetchFromTranscriptApi()
    if (fromApi) {
      return fromApi
    }
  }

  const candidates = collectCandidateUrls(track)

  for (const url of candidates) {
    try {
      const payload = await fetchText(url)
      const parsed = parseTranscriptPayload(payload)
      if (parsed.length > 0) {
        return parsed
      }
    } catch {
      // Continue with the next fallback URL.
    }
  }

  if (!playerBackedTrack) {
    const fromApi = await fetchFromTranscriptApi()
    if (fromApi) {
      return fromApi
    }
  }

  throw new Error(
    `Transcript fetch failed for lang=${track.languageCode} kind=${track.kind ?? "manual"}. URL fallbacks and transcript API fallback both returned empty results.`
  )
}
