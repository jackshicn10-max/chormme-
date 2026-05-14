import { v4 as uuidv4 } from "uuid"

import { buildCsv } from "~lib/export/csv"
import { buildJson } from "~lib/export/json"
import type {
  ClearTranslationCacheResponse,
  ExportVocabResponse,
  MainWorldCurrentCaptionTrackResponse,
  MainWorldFetchTextResponse,
  MainWorldPlayerCaptionUrlResponse,
  MainWorldTranscriptResponse,
  Message,
  MessageResponse,
  PrewarmWordTranslationsResponse,
  SaveWordResponse,
  WordTranslationResponse
} from "~lib/messages"
import {
  loadLearningSettings,
  saveLearningSettings
} from "~lib/settings"
import {
  clearTranslationCache,
  db,
  getCachedTranscript,
  getTranslationCache,
  listAllVocab,
  listRecentVocab,
  saveTranslationCache,
  saveVocabEntry
} from "~lib/storage"
import {
  FALLBACK_TRANSLATION,
  lookupBundledTranslation,
  normalizeLookupWord,
  resolveWordTranslation
} from "~lib/translation/wordTranslation"
import type { LearningSettings, SaveWordPayload, VocabEntry } from "~types"

const asError = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return "Unexpected background failure."
}

const toTimestampedVideoUrl = (videoId: string, timestamp: number): string => {
  const safeSeconds = Math.max(0, Math.floor(timestamp))
  return `https://www.youtube.com/watch?v=${videoId}&t=${safeSeconds}s`
}

const createVocabEntry = (payload: SaveWordPayload): VocabEntry => {
  const now = new Date().toISOString()
  const sentence = payload.transcriptWindow.sentence.trim()
  const contextBefore = payload.transcriptWindow.before.filter(Boolean)
  const contextAfter = payload.transcriptWindow.after.filter(Boolean)
  const contextText = [...contextBefore, sentence, ...contextAfter]
    .filter(Boolean)
    .join(" ")

  return {
    id: uuidv4(),
    word: payload.word,
    normalizedWord: payload.normalizedWord,
    sentence,
    contextText,
    contextBefore,
    contextAfter,
    videoId: payload.videoMeta.videoId,
    videoTitle: payload.videoMeta.title,
    videoUrl: toTimestampedVideoUrl(payload.videoMeta.videoId, payload.timestamp),
    timestamp: Math.floor(payload.timestamp),
    segmentId: payload.segmentId,
    briefMeaning: null,
    detailedMeaning: null,
    note: "",
    createdAt: now,
    updatedAt: now
  }
}

const createTranslationCacheKey = (normalizedWord: string): string => {
  return `word:${normalizedWord}`
}

const MAX_PREWARM_WORDS = 260
const MAX_ONLINE_PREWARM_WORDS = 80
const MAX_MANUAL_PREWARM_WORDS = 2880
const ONLINE_PREWARM_DELAY_MS = 350
const onlinePrewarmQueue: string[] = []
const onlinePrewarmQueuedWords = new Set<string>()
let onlinePrewarmRunning = false

const isUsableTranslationValue = (value: string | null | undefined): boolean => {
  return Boolean(value?.trim() && value.trim() !== FALLBACK_TRANSLATION)
}

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms))

const getCachedTranslationValue = async (
  normalizedWord: string
): Promise<string | null> => {
  const cached = await getTranslationCache(createTranslationCacheKey(normalizedWord))
  return isUsableTranslationValue(cached?.value) ? cached.value : null
}

const saveTranslationMeaning = async (
  normalizedWord: string,
  value: string
): Promise<void> => {
  if (!isUsableTranslationValue(value)) {
    return
  }

  await saveTranslationCache({
    key: createTranslationCacheKey(normalizedWord),
    normalizedWord,
    createdAt: new Date().toISOString(),
    value
  })
}

const getWordTranslation = async (
  word: string
): Promise<WordTranslationResponse> => {
  const normalizedWord = normalizeLookupWord(word)
  if (!normalizedWord) {
    return {
      word,
      normalizedWord: "",
      briefMeaning: FALLBACK_TRANSLATION,
      source: "fallback"
    }
  }

  const localMeaning = lookupBundledTranslation(normalizedWord)
  if (localMeaning) {
    return {
      word,
      normalizedWord,
      briefMeaning: localMeaning,
      source: "local"
    }
  }

  const cached = await getCachedTranslationValue(normalizedWord)
  if (cached) {
    return {
      word,
      normalizedWord,
      briefMeaning: cached,
      source: "cache"
    }
  }

  const resolved = await resolveWordTranslation(word)
  await saveTranslationMeaning(normalizedWord, resolved.briefMeaning)

  return {
    word,
    normalizedWord,
    briefMeaning: resolved.briefMeaning,
    source: resolved.source
  }
}

const drainOnlinePrewarmQueue = async (): Promise<void> => {
  if (onlinePrewarmRunning) {
    return
  }

  onlinePrewarmRunning = true
  try {
    while (onlinePrewarmQueue.length > 0) {
      const normalizedWord = onlinePrewarmQueue.shift()
      if (!normalizedWord) {
        continue
      }
      onlinePrewarmQueuedWords.delete(normalizedWord)

      if (
        lookupBundledTranslation(normalizedWord) ||
        (await getCachedTranslationValue(normalizedWord))
      ) {
        continue
      }

      const resolved = await resolveWordTranslation(normalizedWord)
      await saveTranslationMeaning(resolved.normalizedWord, resolved.briefMeaning)
      await sleep(ONLINE_PREWARM_DELAY_MS)
    }
  } finally {
    onlinePrewarmRunning = false
  }
}

const enqueueOnlinePrewarm = (normalizedWords: string[]): number => {
  let added = 0
  for (const normalizedWord of normalizedWords) {
    if (onlinePrewarmQueuedWords.has(normalizedWord)) {
      continue
    }

    onlinePrewarmQueuedWords.add(normalizedWord)
    onlinePrewarmQueue.push(normalizedWord)
    added += 1
  }

  if (added > 0) {
    void drainOnlinePrewarmQueue().catch(() => undefined)
  }

  return added
}

const runOnlinePrewarmBatch = async (
  normalizedWords: string[]
): Promise<{ online: number; failed: number }> => {
  let online = 0
  let failed = 0

  for (const normalizedWord of normalizedWords) {
    if (
      lookupBundledTranslation(normalizedWord) ||
      (await getCachedTranslationValue(normalizedWord))
    ) {
      online += 1
      continue
    }

    const resolved = await resolveWordTranslation(normalizedWord)
    if (isUsableTranslationValue(resolved.briefMeaning)) {
      await saveTranslationMeaning(resolved.normalizedWord, resolved.briefMeaning)
      online += 1
    } else {
      failed += 1
    }
  }

  return { online, failed }
}

const prewarmWordTranslations = async (
  words: string[],
  options: {
    maxWords?: number
    maxOnlineWords?: number
    waitForOnline?: boolean
  } = {}
): Promise<PrewarmWordTranslationsResponse> => {
  const maxWords = Number.isFinite(options.maxWords)
    ? Math.min(
        MAX_MANUAL_PREWARM_WORDS,
        Math.max(1, Math.floor(options.maxWords ?? MAX_PREWARM_WORDS))
      )
    : MAX_PREWARM_WORDS
  const maxOnlineWords = Number.isFinite(options.maxOnlineWords)
    ? Math.min(
        MAX_MANUAL_PREWARM_WORDS,
        Math.max(0, Math.floor(options.maxOnlineWords ?? MAX_ONLINE_PREWARM_WORDS))
      )
    : MAX_ONLINE_PREWARM_WORDS
  const normalizedWords = Array.from(
    new Set(
      words
        .map((word) => normalizeLookupWord(word))
        .filter((word) => word.length >= 2)
    )
  ).slice(0, maxWords)

  let local = 0
  let cache = 0
  const onlineCandidates: string[] = []

  for (const normalizedWord of normalizedWords) {
    const localMeaning = lookupBundledTranslation(normalizedWord)
    if (localMeaning) {
      local += 1
      void saveTranslationMeaning(normalizedWord, localMeaning).catch(
        () => undefined
      )
      continue
    }

    if (await getCachedTranslationValue(normalizedWord)) {
      cache += 1
      continue
    }

    onlineCandidates.push(normalizedWord)
  }

  const onlineBatch = onlineCandidates.slice(0, maxOnlineWords)
  const skippedOnline = Math.max(0, onlineCandidates.length - onlineBatch.length)
  let online = 0
  let failed = 0
  let queuedOnline = 0

  if (options.waitForOnline) {
    const result = await runOnlinePrewarmBatch(onlineBatch)
    online = result.online
    failed = result.failed + skippedOnline
  } else {
    queuedOnline = enqueueOnlinePrewarm(onlineBatch)
  }

  const cachedOrLocal = local + cache
  const ready = cachedOrLocal + online

  return {
    requested: normalizedWords.length,
    local,
    cache,
    online,
    failed,
    ready,
    cachedOrLocal,
    queuedOnline,
    skippedOnline
  }
}

type MainWorldExecutionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

const requireSenderTabId = (sender: chrome.runtime.MessageSender): number => {
  const tabId = sender.tab?.id
  if (typeof tabId !== "number") {
    throw new Error("Main-world execution requires an active tab context.")
  }
  return tabId
}

const executeInMainWorld = async <T>(
  tabId: number,
  func: (...args: unknown[]) => Promise<MainWorldExecutionResult<T>>,
  args: unknown[] = []
): Promise<T> => {
  const injected = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func,
    args
  })

  const payload = injected[0]?.result as MainWorldExecutionResult<T> | undefined
  if (!payload) {
    throw new Error("Main-world execution returned no payload.")
  }
  if (!payload.ok) {
    const reason =
      "error" in payload
        ? payload.error
        : "Main-world execution returned an unknown error."
    throw new Error(reason)
  }
  return payload.data
}

const getPlayerResponseInMainWorld = async (
  tabId: number
): Promise<unknown | null> => {
  return executeInMainWorld<unknown | null>(tabId, async () => {
    try {
      const scopedWindow = window as unknown as {
        ytInitialPlayerResponse?: unknown
        ytplayer?: {
          config?: {
            args?: {
              raw_player_response?: unknown
            }
          }
        }
      }

      if (scopedWindow.ytInitialPlayerResponse) {
        return { ok: true, data: scopedWindow.ytInitialPlayerResponse }
      }

      const rawPlayerResponse = scopedWindow.ytplayer?.config?.args?.raw_player_response
      if (typeof rawPlayerResponse === "string") {
        try {
          return { ok: true, data: JSON.parse(rawPlayerResponse) }
        } catch {
          return { ok: true, data: null }
        }
      }

      if (rawPlayerResponse && typeof rawPlayerResponse === "object") {
        return { ok: true, data: rawPlayerResponse }
      }

      return { ok: true, data: null }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to read player response."
      }
    }
  })
}

const fetchTextInMainWorld = async (
  tabId: number,
  url: string
): Promise<string> => {
  return executeInMainWorld<string>(tabId, async (requestUrl) => {
    try {
      if (typeof requestUrl !== "string" || !requestUrl) {
        return { ok: false, error: "FETCH_TEXT requires a valid url." }
      }

      const response = await fetch(requestUrl, {
        credentials: "include",
        cache: "no-store"
      })

      if (!response.ok) {
        return {
          ok: false,
          error: `Main-world fetch failed with ${response.status}.`
        }
      }

      const text = await response.text()
      return { ok: true, data: text }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Main-world fetch failed."
      }
    }
  }, [url])
}

const getCurrentCaptionTrackInMainWorld = async (
  tabId: number,
  videoId: string
): Promise<MainWorldCurrentCaptionTrackResponse> => {
  return executeInMainWorld<MainWorldCurrentCaptionTrackResponse>(
    tabId,
    async (targetVideoId) => {
      try {
        if (typeof targetVideoId !== "string" || !targetVideoId) {
          return {
            ok: false,
            error: "GET_CURRENT_CAPTION_TRACK requires videoId."
          }
        }

        const toStringOrNull = (value: unknown): string | null =>
          typeof value === "string" && value.trim() ? value.trim() : null
        const isEnglishCode = (code: string) =>
          code === "en" || code.startsWith("en-")

        const normalizeTrack = (value: unknown) => {
          if (!value || typeof value !== "object") {
            return null
          }

          const raw = value as Record<string, unknown>
          const vssId = toStringOrNull(raw.vssId)
          const languageCode =
            toStringOrNull(raw.languageCode) ??
            toStringOrNull(raw.lang) ??
            (vssId?.replace(/^a\./, "").replace(/^\./, "") ?? null)
          const kind =
            toStringOrNull(raw.kind) ?? (vssId?.startsWith("a.") ? "asr" : null)
          const baseUrl = toStringOrNull(raw.baseUrl)

          if (!languageCode && !vssId && !baseUrl) {
            return null
          }

          return {
            baseUrl,
            languageCode,
            kind,
            vssId,
            url: null
          }
        }

        const findLatestTimedtextUrl = (): string | null => {
          const entries = performance
            .getEntriesByType("resource")
            .map((entry) => entry.name)

          for (let index = entries.length - 1; index >= 0; index -= 1) {
            try {
              const candidate = new URL(entries[index])
              if (!candidate.pathname.includes("/api/timedtext")) {
                continue
              }
              if (candidate.searchParams.get("v") !== targetVideoId) {
                continue
              }
              if (candidate.searchParams.has("tlang")) {
                continue
              }

              const lang = candidate.searchParams.get("lang") ?? ""
              if (!isEnglishCode(lang)) {
                continue
              }

              return candidate.toString()
            } catch {
              // Try the previous resource entry.
            }
          }

          return null
        }

        let currentTrack: null | {
          baseUrl?: string | null
          languageCode?: string | null
          kind?: string | null
          url?: string | null
          vssId?: string | null
        } = null
        try {
          const player = document.querySelector("#movie_player") as
            | {
                getOption?: (module: string, option: string) => unknown
              }
            | null
          currentTrack = normalizeTrack(player?.getOption?.("captions", "track"))
        } catch {
          currentTrack = null
        }

        const latestUrl = findLatestTimedtextUrl()
        if (latestUrl) {
          try {
            const url = new URL(latestUrl)
            currentTrack = {
              ...(currentTrack ?? {}),
              baseUrl: currentTrack?.baseUrl ?? latestUrl,
              languageCode:
                currentTrack?.languageCode ?? url.searchParams.get("lang"),
              kind:
                currentTrack?.kind ??
                url.searchParams.get("kind") ??
                (url.searchParams.has("pot") ? "asr" : null),
              url: latestUrl,
              vssId: currentTrack?.vssId ?? null
            }
          } catch {
            // Keep the getOption result if URL parsing fails.
          }
        }

        return {
          ok: true,
          data: {
            track: currentTrack,
            url: latestUrl
          }
        }
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to read current caption track."
        }
      }
    },
    [videoId]
  )
}

const getPlayerCaptionUrlInMainWorld = async (
  tabId: number,
  videoId: string,
  languageCode: string,
  kind?: string
): Promise<MainWorldPlayerCaptionUrlResponse> => {
  const url = await executeInMainWorld<string | null>(
    tabId,
    async (targetVideoId, targetLanguageCode, targetKind) => {
      try {
        if (typeof targetVideoId !== "string" || !targetVideoId) {
          return { ok: false, error: "GET_PLAYER_CAPTION_URL requires videoId." }
        }
        if (typeof targetLanguageCode !== "string" || !targetLanguageCode) {
          return {
            ok: false,
            error: "GET_PLAYER_CAPTION_URL requires languageCode."
          }
        }

        const sleep = (ms: number) =>
          new Promise((resolve) => setTimeout(resolve, ms))
        const isEnglishCode = (code: string) =>
          code === "en" || code.startsWith("en-")
        const findCaptionUrl = (): string | null => {
          const entries = performance
            .getEntriesByType("resource")
            .map((entry) => entry.name)

          for (let index = entries.length - 1; index >= 0; index -= 1) {
            try {
              const candidate = new URL(entries[index])
              if (!candidate.pathname.includes("/api/timedtext")) {
                continue
              }
              if (candidate.searchParams.get("v") !== targetVideoId) {
                continue
              }
              if (candidate.searchParams.get("fmt") !== "json3") {
                continue
              }
              if (!candidate.searchParams.has("pot")) {
                continue
              }
              if (candidate.searchParams.has("tlang")) {
                continue
              }

              const lang =
                candidate.searchParams.get("lang") ?? targetLanguageCode
              if (!isEnglishCode(lang)) {
                continue
              }

              return candidate.toString()
            } catch {
              // Try the previous resource entry.
            }
          }

          return null
        }

        const existing = findCaptionUrl()
        if (existing) {
          return { ok: true, data: existing }
        }

        const player = document.querySelector("#movie_player") as
          | {
              loadModule?: (name: string) => void
              setOption?: (module: string, option: string, value: unknown) => void
            }
          | null
        try {
          player?.loadModule?.("captions")
          player?.setOption?.("captions", "track", {
            languageCode: targetLanguageCode,
            kind: typeof targetKind === "string" ? targetKind : undefined
          })
        } catch {
          // Fall back to the CC button.
        }

        const button =
          document.querySelector<HTMLButtonElement>(".ytp-subtitles-button")
        if (button && button.getAttribute("aria-pressed") !== "true") {
          button.click()
        }

        const startedAt = Date.now()
        while (Date.now() - startedAt < 9000) {
          const found = findCaptionUrl()
          if (found) {
            return { ok: true, data: found }
          }
          await sleep(250)
        }

        return { ok: true, data: null }
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to read player caption URL."
        }
      }
    },
    [videoId, languageCode, kind ?? ""]
  )

  return { url }
}

const fetchTranscriptFromApiInMainWorld = async (
  tabId: number,
  videoId: string
): Promise<MainWorldTranscriptResponse> => {
  const segments = await executeInMainWorld<MainWorldTranscriptResponse["segments"]>(
    tabId,
    async (targetVideoId) => {
      try {
        if (typeof targetVideoId !== "string" || !targetVideoId) {
          return { ok: false, error: "GET_TRANSCRIPT_FROM_API requires videoId." }
        }

        const getYtCfgValue = (key: string): unknown => {
          const ytcfg = (window as unknown as { ytcfg?: { get?: (name: string) => unknown; data_?: Record<string, unknown> } }).ytcfg
          if (!ytcfg) {
            return undefined
          }
          const byGetter = ytcfg.get?.(key)
          if (byGetter !== undefined) {
            return byGetter
          }
          return ytcfg.data_?.[key]
        }

        const collectTranscriptParams = (): string[] => {
          const output = new Set<string>()
          const scopedWindow = window as unknown as {
            ytInitialData?: unknown
            ytInitialPlayerResponse?: unknown
          }
          const sources: string[] = []

          for (const source of [
            scopedWindow.ytInitialData,
            scopedWindow.ytInitialPlayerResponse
          ]) {
            try {
              if (source) {
                sources.push(JSON.stringify(source))
              }
            } catch {
              // Ignore cyclic or unserializable objects.
            }
          }

          sources.push(document.documentElement?.innerHTML ?? "")

          for (const source of sources) {
            const patterns = [
              /"getTranscriptEndpoint":\{"params":"([^"]+)"/g,
              /"getTranscriptEndpoint"\s*:\s*\{\s*"params"\s*:\s*"([^"]+)"/g
            ]

            for (const pattern of patterns) {
              let match: RegExpExecArray | null
              while ((match = pattern.exec(source)) !== null) {
                if (!match[1]) {
                  continue
                }
                output.add(match[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/"))
              }
            }
          }

          return Array.from(output)
        }

        const toMs = (input: unknown): number => {
          if (typeof input === "number" && Number.isFinite(input)) {
            return input
          }
          if (typeof input === "string") {
            const clean = input.trim()
            if (/^\d+(\.\d+)?$/.test(clean)) {
              return Number.parseFloat(clean)
            }

            const parts = clean.split(":").map((part) => Number.parseFloat(part))
            if (parts.some((part) => Number.isNaN(part))) {
              return Number.NaN
            }

            let seconds = 0
            for (const value of parts) {
              seconds = seconds * 60 + value
            }
            return seconds * 1000
          }
          return Number.NaN
        }

        const extractText = (value: unknown): string => {
          const payload = value as
            | {
                simpleText?: unknown
                runs?: Array<{ text?: unknown }>
              }
            | undefined
          if (!payload || typeof payload !== "object") {
            return ""
          }
          if (typeof payload.simpleText === "string") {
            return payload.simpleText.trim()
          }
          if (Array.isArray(payload.runs)) {
            return payload.runs
              .map((row) => (typeof row?.text === "string" ? row.text : ""))
              .join("")
              .trim()
          }
          return ""
        }

        const parseSegments = (payload: unknown) => {
          const rows: Array<{ start: number; end: number; text: string }> = []
          const queue: unknown[] = [payload]
          const visited = new WeakSet<object>()
          const dedupe = new Set<string>()

          while (queue.length > 0) {
            const node = queue.shift()
            if (!node || typeof node !== "object") {
              continue
            }

            const objectNode = node as Record<string, unknown>
            if (visited.has(objectNode)) {
              continue
            }
            visited.add(objectNode)

            const pushRow = (startMs: number, endMs: number, text: string) => {
              if (!Number.isFinite(startMs) || !text) {
                return
              }
              const key = `${Math.floor(startMs)}::${text}`
              if (dedupe.has(key)) {
                return
              }
              dedupe.add(key)
              const start = Math.max(0, startMs / 1000)
              const end = Math.max(start + 0.05, endMs / 1000)
              rows.push({ start, end, text })
            }

            if (objectNode.transcriptSegmentRenderer) {
              const segment = objectNode.transcriptSegmentRenderer as Record<string, unknown>
              const startMs = toMs(segment.startMs ?? segment.startTimeMs)
              const endMs = toMs(segment.endMs ?? segment.endTimeMs)
              const durationMs = toMs(segment.durationMs)
              const text = extractText(segment.snippet ?? segment.cue ?? segment.text)
              const fallbackEndMs =
                Number.isFinite(endMs) && endMs > startMs
                  ? endMs
                  : startMs + (Number.isFinite(durationMs) ? durationMs : 3000)
              pushRow(startMs, fallbackEndMs, text)
            }

            if (objectNode.transcriptCueRenderer) {
              const cue = objectNode.transcriptCueRenderer as Record<string, unknown>
              const startMs = toMs(cue.startOffsetMs ?? cue.startMs)
              const durationMs = toMs(cue.durationMs)
              const endMs = startMs + (Number.isFinite(durationMs) ? durationMs : 3000)
              const text = extractText(cue.cue ?? cue.snippet ?? cue.text)
              pushRow(startMs, endMs, text)
            }

            for (const value of Object.values(objectNode)) {
              if (Array.isArray(value)) {
                queue.push(...value)
                continue
              }
              if (value && typeof value === "object") {
                queue.push(value)
              }
            }
          }

          rows.sort((a, b) => a.start - b.start)
          return rows
        }

        const apiKey = getYtCfgValue("INNERTUBE_API_KEY")
        if (typeof apiKey !== "string" || !apiKey) {
          return { ok: true, data: null }
        }

        const rawContext = getYtCfgValue("INNERTUBE_CONTEXT")
        const context =
          rawContext && typeof rawContext === "object"
            ? (rawContext as Record<string, unknown>)
            : {
                client: {
                  clientName: "WEB",
                  clientVersion: String(
                    getYtCfgValue("INNERTUBE_CONTEXT_CLIENT_VERSION") ??
                      "2.20260421.00.00"
                  )
                }
              }
        const client = (context.client as Record<string, unknown> | undefined) ?? {}
        const clientName = String(
          client.clientName ?? getYtCfgValue("INNERTUBE_CONTEXT_CLIENT_NAME") ?? "WEB"
        )
        const clientVersion = String(
          client.clientVersion ??
            getYtCfgValue("INNERTUBE_CONTEXT_CLIENT_VERSION") ??
            "2.20260421.00.00"
        )
        const visitorData = String(getYtCfgValue("VISITOR_DATA") ?? "")

        const endpoints = [
          `https://www.youtube.com/youtubei/v1/get_transcript?key=${encodeURIComponent(
            apiKey
          )}`,
          `https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false&key=${encodeURIComponent(
            apiKey
          )}`,
          "https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false"
        ]
        const headers: Record<string, string> = {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
          "x-youtube-client-name": clientName,
          "x-youtube-client-version": clientVersion
        }
        if (visitorData) {
          headers["x-goog-visitor-id"] = visitorData
        }

        const params = collectTranscriptParams()
        if (!params.length) {
          return { ok: true, data: null }
        }

        for (const param of params) {
          const candidates = new Set<string>([param])
          try {
            candidates.add(decodeURIComponent(param))
          } catch {
            // ignore decode failure
          }

          for (const candidate of candidates) {
            try {
              for (const endpoint of endpoints) {
                const response = await fetch(endpoint, {
                  method: "POST",
                  credentials: "include",
                  cache: "no-store",
                  headers,
                  body: JSON.stringify({ context, params: candidate })
                })

                if (!response.ok) {
                  continue
                }

                const payload = await response.json()
                const segments = parseSegments(payload)
                if (segments.length > 0) {
                  return { ok: true, data: segments }
                }
              }
            } catch {
              // continue
            }
          }
        }

        return { ok: true, data: null }
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to request transcript API in main-world."
        }
      }
    },
    [videoId]
  )

  return { segments: segments ?? null }
}

const handleMessage = async (
  message: Message,
  sender: chrome.runtime.MessageSender
): Promise<MessageResponse<unknown>> => {
  switch (message.type) {
    case "GET_TRANSCRIPT": {
      const cached = await getCachedTranscript(message.payload.videoId)
      if (!cached) {
        return { ok: true, data: { segments: null } }
      }

      if (cached.trackUrl !== message.payload.trackUrl) {
        return { ok: true, data: { segments: null } }
      }

      return { ok: true, data: { segments: cached.segments } }
    }

    case "SAVE_WORD": {
      const entry = createVocabEntry(message.payload)
      const translation = await getWordTranslation(message.payload.word)
      if (isUsableTranslationValue(translation.briefMeaning)) {
        entry.briefMeaning = translation.briefMeaning
      }
      const savedEntry = await saveVocabEntry(entry)

      const response: SaveWordResponse = { entry: savedEntry }
      return { ok: true, data: response }
    }

    case "GET_RECENT_VOCAB": {
      const limit = Number.isFinite(message.payload.limit)
        ? Math.max(0, Math.floor(message.payload.limit))
        : 0
      const records = await listRecentVocab(limit, message.payload.videoId)
      return { ok: true, data: records }
    }

    case "EXPORT_VOCAB": {
      const records = await listAllVocab(message.payload.videoId)
      const scope = message.payload.videoId ?? "all"
      if (message.payload.format === "csv") {
        const response: ExportVocabResponse = {
          filename: `youtube-vocab-${scope}-${Date.now()}.csv`,
          mimeType: "text/csv;charset=utf-8",
          content: buildCsv(records)
        }
        return { ok: true, data: response }
      }

      const response: ExportVocabResponse = {
        filename: `youtube-vocab-${scope}-${Date.now()}.json`,
        mimeType: "application/json;charset=utf-8",
        content: buildJson(records)
      }
      return { ok: true, data: response }
    }

    case "GET_SETTINGS": {
      const settings: LearningSettings = await loadLearningSettings()
      return { ok: true, data: settings }
    }

    case "SAVE_SETTINGS": {
      const settings = await saveLearningSettings(message.payload)
      return { ok: true, data: settings }
    }

    case "CLEAR_TRANSLATION_CACHE": {
      await clearTranslationCache()
      const response: ClearTranslationCacheResponse = { cleared: true }
      return { ok: true, data: response }
    }

    case "GET_WORD_TRANSLATION": {
      const response = await getWordTranslation(message.payload.word)
      return { ok: true, data: response }
    }

    case "PREWARM_WORD_TRANSLATIONS": {
      const response = await prewarmWordTranslations(message.payload.words, {
        maxWords: message.payload.maxWords,
        maxOnlineWords: message.payload.maxOnlineWords,
        waitForOnline: message.payload.waitForOnline
      })
      return { ok: true, data: response }
    }

    case "OPEN_VOCAB_TAB": {
      const query = message.payload.videoId
        ? `?videoId=${encodeURIComponent(message.payload.videoId)}`
        : ""
      await chrome.tabs.create({
        active: true,
        url: chrome.runtime.getURL(`tabs/vocab.html${query}`)
      })
      return { ok: true, data: { opened: true } }
    }

    case "OPEN_SETTINGS_TAB": {
      await chrome.tabs.create({
        active: true,
        url: chrome.runtime.getURL("tabs/settings.html")
      })
      return { ok: true, data: { opened: true } }
    }

    case "MAIN_WORLD_GET_PLAYER_RESPONSE": {
      const tabId = requireSenderTabId(sender)
      const data = await getPlayerResponseInMainWorld(tabId)
      return { ok: true, data }
    }

    case "MAIN_WORLD_FETCH_TEXT": {
      const tabId = requireSenderTabId(sender)
      const text = await fetchTextInMainWorld(tabId, message.payload.url)
      const response: MainWorldFetchTextResponse = { text }
      return { ok: true, data: response }
    }

    case "MAIN_WORLD_GET_TRANSCRIPT_API": {
      const tabId = requireSenderTabId(sender)
      const response = await fetchTranscriptFromApiInMainWorld(
        tabId,
        message.payload.videoId
      )
      return { ok: true, data: response }
    }

    case "MAIN_WORLD_GET_CURRENT_CAPTION_TRACK": {
      const tabId = requireSenderTabId(sender)
      const response = await getCurrentCaptionTrackInMainWorld(
        tabId,
        message.payload.videoId
      )
      return { ok: true, data: response }
    }

    case "MAIN_WORLD_GET_PLAYER_CAPTION_URL": {
      const tabId = requireSenderTabId(sender)
      const response = await getPlayerCaptionUrlInMainWorld(
        tabId,
        message.payload.videoId,
        message.payload.languageCode,
        message.payload.kind
      )
      return { ok: true, data: response }
    }

    default: {
      return { ok: false, error: "Unknown message type." }
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
    try {
      const typed = message as Message
      const result = await handleMessage(typed, sender)
      sendResponse(result)
    } catch (error) {
      sendResponse({ ok: false, error: asError(error) } satisfies MessageResponse)
    }
  })()

  return true
})

chrome.runtime.onInstalled.addListener(() => {
  void db.open()
})
