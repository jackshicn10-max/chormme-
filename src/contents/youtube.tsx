import type { PlasmoCSConfig } from "plasmo"
import { useEffect, useMemo, useRef, useState } from "react"

import { CaptionPanel } from "~components/CaptionPanel"
import { PlayerCaptionOverlay } from "~components/PlayerCaptionOverlay"
import {
  hasMountedPanel,
  mountPanel,
  unmountPanel
} from "~lib/content/mount"
import { readInitialPlayerResponse } from "~lib/content/playerResponse"
import { requestCurrentCaptionTrack } from "~lib/mainWorldBridge"
import type {
  ExportVocabResponse,
  GetTranscriptResponse,
  PrewarmWordTranslationsResponse,
  SaveWordResponse
} from "~lib/messages"
import { sendRuntimeMessage } from "~lib/messages"
import { DEFAULT_LEARNING_SETTINGS } from "~lib/settings"
import { findActiveSegmentIndex } from "~lib/transcript/activeSegment"
import { buildTranscriptWindow } from "~lib/transcript/context"
import { createReadableCaptionSegments } from "~lib/transcript/readableSegments"
import { withRuntimeTokens } from "~lib/transcript/tokenize"
import type { CaptionTrack } from "~lib/transcript/types"
import {
  extractCaptionTracks,
  fetchTranscriptSegments,
  isPlayerBackedCaptionTrack,
  selectCurrentCaptionTrack,
  selectEnglishTracks
} from "~lib/transcript/youtubeTrack"
import type {
  ExportFormat,
  LearningSettings,
  TranscriptSegment,
  VideoMeta,
  VocabEntry,
  WordToken
} from "~types"

export const config: PlasmoCSConfig = {
  matches: ["https://www.youtube.com/*", "https://youtube.com/*"]
}

const TOGGLE_BUTTON_ID = "yt-learning-tools-toggle-button"
const PREWARM_WORD_LIMIT = 320
const MANUAL_PREWARM_MINUTES = 20

const isWatchPage = (): boolean => {
  return (
    location.pathname === "/watch" &&
    Boolean(new URLSearchParams(location.search).get("v"))
  )
}

const getCurrentVideoId = (): string | null => {
  return new URLSearchParams(location.search).get("v")
}

const getPageVideoTitle = (): string => {
  const titleNode = document.querySelector(
    "h1.ytd-watch-metadata yt-formatted-string"
  )
  const candidate = titleNode?.textContent?.trim()
  if (candidate) {
    return candidate
  }

  return document.title.replace(/\s*-\s*YouTube$/i, "").trim() || "Untitled Video"
}

const getVideoElement = (): HTMLVideoElement | null => {
  return document.querySelector("video")
}

const resolveCandidateTracks = async (
  videoId: string
): Promise<CaptionTrack[]> => {
  const [playerResponse, currentCaption] = await Promise.all([
    readInitialPlayerResponse(),
    requestCurrentCaptionTrack(videoId)
  ])
  const tracks = extractCaptionTracks(playerResponse)
  const currentTrack = currentCaption?.track ??
    (currentCaption?.url ? { url: currentCaption.url } : null)

  const selected: CaptionTrack[] = []
  const seen = new Set<string>()
  const addTrack = (track: CaptionTrack | null) => {
    if (!track || seen.has(track.baseUrl)) {
      return
    }
    seen.add(track.baseUrl)
    selected.push(track)
  }

  addTrack(selectCurrentCaptionTrack(tracks, currentTrack))
  for (const track of selectEnglishTracks(tracks)) {
    addTrack(track)
  }

  return selected
}

const formatTrackLabel = (track: CaptionTrack): string => {
  const language = track.languageCode || "en"
  return track.kind === "asr"
    ? `${language} 自动生成`
    : `${language} 手动字幕`
}

const formatSegmentsForReading = (
  track: CaptionTrack,
  segments: Parameters<typeof createReadableCaptionSegments>[0]
) => {
  return createReadableCaptionSegments(
    segments,
    isPlayerBackedCaptionTrack(track)
  )
}

const toFriendlyTranscriptError = (reason: unknown): string => {
  const raw = reason instanceof Error ? reason.message : String(reason)

  if (/empty|failed|transcript/i.test(raw)) {
    return [
      "可用英文字幕轨道没有返回内容。",
      "已尝试当前字幕和可用英文字幕，请稍后点“刷新字幕”重试。",
      `技术信息：${raw}`
    ].join("\n")
  }

  return raw || "字幕加载失败，请稍后点“刷新字幕”重试。"
}

const YouTubeCaptionApp = ({
  video,
  videoMeta,
  onDisable
}: {
  video: HTMLVideoElement
  videoMeta: VideoMeta
  onDisable: () => void
}) => {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [currentTime, setCurrentTime] = useState(0)
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<string | null>(null)
  const [prewarmStatus, setPrewarmStatus] = useState<string | null>(null)
  const [manualPrewarming, setManualPrewarming] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [trackLabel, setTrackLabel] = useState<string | null>(null)
  const [settings, setSettings] = useState<LearningSettings>(
    DEFAULT_LEARNING_SETTINGS
  )
  const prewarmKeyRef = useRef<string | null>(null)
  const currentTimeRef = useRef(0)

  const collectWordsForManualPrewarm = (): string[] => {
    const current = Math.max(0, video.currentTime || currentTimeRef.current)
    const end =
      settings.manualTranslationPrewarmScope === "remaining"
        ? Number.POSITIVE_INFINITY
        : current + MANUAL_PREWARM_MINUTES * 60
    const wordLimit = settings.manualTranslationPrewarmWordLimit
    const seenWords = new Set<string>()
    const words: string[] = []

    for (const segment of segments) {
      if (segment.end < current) {
        continue
      }
      if (segment.start > end) {
        break
      }

      for (const token of segment.tokens) {
        if (token.normalized.length < 2 || seenWords.has(token.normalized)) {
          continue
        }

        seenWords.add(token.normalized)
        words.push(token.normalized)
        if (words.length >= wordLimit) {
          return words
        }
      }
    }

    return words
  }

  useEffect(() => {
    let cancelled = false

    const loadSettings = async () => {
      const response = await sendRuntimeMessage<LearningSettings>({
        type: "GET_SETTINGS",
        payload: {}
      })

      if (!cancelled && response.ok) {
        setSettings(response.data)
      }
    }

    void loadSettings()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadTranscript = async () => {
      setLoading(true)
      setError(null)
      setSegments([])
      setTrackLabel(null)

      try {
        const tracks = await resolveCandidateTracks(videoMeta.videoId)
        if (!tracks.length) {
          if (!cancelled) {
            setError(
              "没有找到英文字幕。请先在 YouTube 字幕菜单里选择 English 或 English (auto-generated)，然后点“刷新字幕”。"
            )
          }
          return
        }

        const errors: string[] = []

        for (const track of tracks) {
          if (!cancelled) {
            setTrackLabel(formatTrackLabel(track))
          }

          try {
            const cachedResponse = await sendRuntimeMessage<GetTranscriptResponse>({
              type: "GET_TRANSCRIPT",
              payload: {
                videoId: videoMeta.videoId,
                trackUrl: track.baseUrl
              }
            })

            if (cachedResponse.ok && cachedResponse.data?.segments?.length) {
              if (!cancelled) {
                setSegments(
                  withRuntimeTokens(
                    formatSegmentsForReading(track, cachedResponse.data.segments)
                  )
                )
              }
              return
            }

            const fetched = await fetchTranscriptSegments(track)
            if (!cancelled) {
              setSegments(withRuntimeTokens(formatSegmentsForReading(track, fetched)))
            }
            return
          } catch (trackError) {
            const message =
              trackError instanceof Error ? trackError.message : String(trackError)
            errors.push(`${formatTrackLabel(track)}: ${message}`)
          }
        }

        throw new Error(
          errors.length
            ? errors.join(" | ")
            : "Transcript fetch failed for all English caption tracks."
        )
      } catch (reason) {
        if (!cancelled) {
          setError(toFriendlyTranscriptError(reason))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadTranscript()

    return () => {
      cancelled = true
    }
  }, [reloadNonce, videoMeta.videoId])

  useEffect(() => {
    let cancelled = false

    const loadSavedWords = async () => {
      const response = await sendRuntimeMessage<VocabEntry[]>({
        type: "GET_RECENT_VOCAB",
        payload: { limit: 5000, videoId: videoMeta.videoId }
      })

      if (!response.ok || !Array.isArray(response.data)) {
        return
      }

      const words = response.data
        .filter((entry) => typeof entry?.normalizedWord === "string")
        .map((entry) => entry.normalizedWord)

      if (!cancelled) {
        setSavedWords(new Set(words))
      }
    }

    void loadSavedWords()

    return () => {
      cancelled = true
    }
  }, [videoMeta.videoId])

  useEffect(() => {
    if (!settings.enableTranslationPrewarm || !segments.length) {
      return
    }

    const firstSegment = segments[0]
    const lastSegment = segments[segments.length - 1]
    const prewarmKey = `${videoMeta.videoId}:${segments.length}:${firstSegment.id}:${lastSegment.id}`
    if (prewarmKeyRef.current === prewarmKey) {
      return
    }
    prewarmKeyRef.current = prewarmKey

    const seenWords = new Set<string>()
    const words: string[] = []
    for (const segment of segments) {
      for (const token of segment.tokens) {
        if (token.normalized.length < 2 || seenWords.has(token.normalized)) {
          continue
        }

        seenWords.add(token.normalized)
        words.push(token.normalized)
        if (words.length >= PREWARM_WORD_LIMIT) {
          break
        }
      }

      if (words.length >= PREWARM_WORD_LIMIT) {
        break
      }
    }

    if (!words.length) {
      return
    }

    void sendRuntimeMessage(
      {
        type: "PREWARM_WORD_TRANSLATIONS",
        payload: { words }
      },
      3000
    )
  }, [segments, settings.enableTranslationPrewarm, videoMeta.videoId])

  useEffect(() => {
    let frame: number | null = null

    const syncCurrentTime = () => {
      const next = video.currentTime
      if (Math.abs(next - currentTimeRef.current) < 0.06) {
        return
      }

      currentTimeRef.current = next
      setCurrentTime(next)
    }

    const tick = () => {
      syncCurrentTime()
      frame = video.paused || video.ended ? null : window.requestAnimationFrame(tick)
    }

    const startTicker = () => {
      if (frame !== null) {
        return
      }
      frame = window.requestAnimationFrame(tick)
    }

    const stopTicker = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
        frame = null
      }
      syncCurrentTime()
    }

    syncCurrentTime()
    if (!video.paused && !video.ended) {
      startTicker()
    }

    video.addEventListener("play", startTicker)
    video.addEventListener("playing", startTicker)
    video.addEventListener("pause", stopTicker)
    video.addEventListener("seeked", syncCurrentTime)
    video.addEventListener("timeupdate", syncCurrentTime)

    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
      }
      video.removeEventListener("play", startTicker)
      video.removeEventListener("playing", startTicker)
      video.removeEventListener("pause", stopTicker)
      video.removeEventListener("seeked", syncCurrentTime)
      video.removeEventListener("timeupdate", syncCurrentTime)
    }
  }, [video])

  useEffect(() => {
    if (!toast) {
      return
    }

    const timer = window.setTimeout(() => setToast(null), 1600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const activeSegment = useMemo(() => {
    if (!segments.length) {
      return null
    }

    const index = findActiveSegmentIndex(
      segments,
      currentTime + settings.captionLeadSeconds
    )
    if (index < 0) {
      return null
    }

    return segments[index]
  }, [segments, currentTime, settings.captionLeadSeconds])

  const activeSegmentId = activeSegment?.id ?? null

  const handleSaveWord = async (token: WordToken, segment: TranscriptSegment) => {
    const segmentIndex = segments.findIndex((item) => item.id === segment.id)
    if (segmentIndex < 0) {
      return
    }

    const transcriptWindow = buildTranscriptWindow(segments, segmentIndex)

    const response = await sendRuntimeMessage<SaveWordResponse>({
      type: "SAVE_WORD",
      payload: {
        word: token.surface,
        normalizedWord: token.normalized,
        segmentId: segment.id,
        timestamp: Math.floor(segment.start),
        videoMeta,
        transcriptWindow: {
          sentence: transcriptWindow.sentence,
          before: transcriptWindow.before,
          after: transcriptWindow.after
        }
      }
    })

    if (!response.ok) {
      setToast("保存失败")
      return
    }

    setSavedWords((previous) => {
      const next = new Set(previous)
      next.add(token.normalized)
      return next
    })
    setToast(`已保存 ${token.surface}`)
  }

  const openVocab = async () => {
    const response = await sendRuntimeMessage({
      type: "OPEN_VOCAB_TAB",
      payload: { videoId: videoMeta.videoId }
    })
    if (!response.ok) {
      setToast("打开生词本失败")
    }
  }

  const openSettings = async () => {
    const response = await sendRuntimeMessage({
      type: "OPEN_SETTINGS_TAB",
      payload: {}
    })
    if (!response.ok) {
      setToast("打开设置失败")
    }
  }

  const prewarmTranslationsFromCurrentTime = async () => {
    if (manualPrewarming) {
      return
    }

    const words = collectWordsForManualPrewarm()
    if (!words.length) {
      setPrewarmStatus("没有找到可预热的后续单词")
      return
    }

    setManualPrewarming(true)
    setPrewarmStatus(`预热中：正在处理 ${words.length} 个唯一词`)
    const response = await sendRuntimeMessage<PrewarmWordTranslationsResponse>(
      {
        type: "PREWARM_WORD_TRANSLATIONS",
        payload: {
          words,
          maxWords: settings.manualTranslationPrewarmWordLimit,
          maxOnlineWords: settings.manualTranslationPrewarmWordLimit,
          waitForOnline: true
        }
      },
      180000
    )
    setManualPrewarming(false)

    if (!response.ok) {
      setPrewarmStatus("预热失败")
      setToast("预热释义失败")
      return
    }

    const scopeText =
      settings.manualTranslationPrewarmScope === "remaining"
        ? "本视频剩余"
        : `后续 ${MANUAL_PREWARM_MINUTES} 分钟`
    const failedText =
      response.data.failed > 0 ? `，失败 ${response.data.failed} 个` : ""
    setPrewarmStatus(
      `${scopeText}：已就绪 ${response.data.ready}/${response.data.requested} 个（本地 ${response.data.local}，缓存 ${response.data.cache}，在线 ${response.data.online}${failedText}）`
    )
  }

  return (
    <>
      <PlayerCaptionOverlay video={video} segment={activeSegment} />
      <CaptionPanel
        open
        loading={loading}
        error={error}
        videoMeta={videoMeta}
        segments={segments}
        activeSegmentId={activeSegmentId}
        savedWords={savedWords}
        translationEnabled={settings.enableHoverTranslation}
        toast={toast}
        trackLabel={trackLabel}
        onToggleOpen={onDisable}
        onOpenVocab={openVocab}
        onOpenSettings={openSettings}
        onRefresh={() => setReloadNonce((previous) => previous + 1)}
        onPrewarmTranslations={prewarmTranslationsFromCurrentTime}
        prewarmStatus={prewarmStatus}
        prewarmLoading={manualPrewarming}
        onSeek={(segment) => {
          video.currentTime = Math.max(0, segment.start)
        }}
        onSaveWord={handleSaveWord}
      />
    </>
  )
}

const downloadBlob = (payload: ExportVocabResponse) => {
  const blob = new Blob([payload.content], { type: payload.mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = payload.filename
  anchor.click()
  URL.revokeObjectURL(url)
}

const exportFromConsole = async (format: ExportFormat) => {
  const response = await sendRuntimeMessage<ExportVocabResponse>({
    type: "EXPORT_VOCAB",
    payload: { format }
  })
  if (response.ok) {
    downloadBlob(response.data)
  }
}

declare global {
  interface Window {
    __YT_LEARNING_TOOLS_EXPORT__?: (format: ExportFormat) => Promise<void>
  }
}

window.__YT_LEARNING_TOOLS_EXPORT__ = exportFromConsole

let latestHref = location.href
let mountTimer: number | null = null
let mountedKey: string | null = null
let learningToolsEnabled = false
let startupSettingsApplied = false
let defaultLearningToolsEnabled = false

const updateToggleButtonState = (button: HTMLButtonElement) => {
  button.textContent = learningToolsEnabled ? "LT ON" : "LT OFF"
  button.title = learningToolsEnabled
    ? "关闭 YouTube 学习字幕面板"
    : "打开 YouTube 学习字幕面板"
  button.setAttribute("aria-pressed", String(learningToolsEnabled))
  button.style.opacity = learningToolsEnabled ? "1" : "0.72"
}

const styleToggleButton = (button: HTMLButtonElement) => {
  button.id = TOGGLE_BUTTON_ID
  button.type = "button"
  button.className = "ytp-button yt-learning-tools-toggle"
  button.style.display = "inline-flex"
  button.style.alignItems = "center"
  button.style.justifyContent = "center"
  button.style.width = "auto"
  button.style.minWidth = "58px"
  button.style.padding = "0 8px"
  button.style.fontSize = "12px"
  button.style.fontWeight = "700"
  button.style.letterSpacing = "0.02em"
  button.style.color = "#fff"
  button.style.textShadow = "0 1px 2px rgba(0, 0, 0, 0.75)"
}

const setLearningToolsEnabled = (enabled: boolean) => {
  learningToolsEnabled = enabled
  ensureToggleButton()

  if (!enabled) {
    unmountPanel()
    mountedKey = null
    return
  }

  scheduleMount()
}

const ensureToggleButton = () => {
  if (!isWatchPage()) {
    document.getElementById(TOGGLE_BUTTON_ID)?.remove()
    return
  }

  const controls = document.querySelector<HTMLElement>(".ytp-left-controls")
  let button = document.getElementById(TOGGLE_BUTTON_ID) as HTMLButtonElement | null

  if (!button) {
    button = document.createElement("button")
    styleToggleButton(button)

    for (const eventName of ["click", "mousedown", "mouseup", "dblclick"]) {
      button.addEventListener(eventName, (event) => {
        event.preventDefault()
        event.stopPropagation()
      })
    }

    button.addEventListener("click", () => {
      setLearningToolsEnabled(!learningToolsEnabled)
    })
  }

  updateToggleButtonState(button)

  if (controls) {
    button.style.position = ""
    button.style.left = ""
    button.style.bottom = ""
    button.style.zIndex = ""
    if (button.parentElement !== controls) {
      controls.appendChild(button)
    }
    return
  }

  if (!button.isConnected) {
    if (!document.body) {
      return
    }
    button.style.position = "fixed"
    button.style.left = "460px"
    button.style.bottom = "28px"
    button.style.zIndex = "999999"
    document.body.appendChild(button)
  }
}

const scheduleMount = () => {
  ensureToggleButton()

  if (mountTimer !== null) {
    window.clearTimeout(mountTimer)
  }

  mountTimer = window.setTimeout(() => {
    void mountCurrentVideo()
  }, 150)
}

const mountCurrentVideo = async () => {
  ensureToggleButton()

  if (!isWatchPage()) {
    unmountPanel()
    mountedKey = null
    return
  }

  if (!learningToolsEnabled) {
    unmountPanel()
    mountedKey = null
    return
  }

  const videoId = getCurrentVideoId()
  const video = getVideoElement()

  if (!videoId || !video) {
    scheduleMount()
    return
  }

  const videoMeta: VideoMeta = {
    platform: "youtube",
    videoId,
    title: getPageVideoTitle(),
    url: `https://www.youtube.com/watch?v=${videoId}`
  }

  const keyPrefix = `${videoMeta.videoId}:enabled`
  if (mountedKey === keyPrefix && hasMountedPanel()) {
    return
  }

  mountPanel(
    <YouTubeCaptionApp
      key={videoMeta.videoId}
      video={video}
      videoMeta={videoMeta}
      onDisable={() => setLearningToolsEnabled(false)}
    />
  )
  mountedKey = keyPrefix
}

const handlePageUpdate = () => {
  ensureToggleButton()

  if (location.href !== latestHref) {
    latestHref = location.href
    mountedKey = null
    if (defaultLearningToolsEnabled && isWatchPage()) {
      learningToolsEnabled = true
    }
    scheduleMount()
    return
  }

  if (isWatchPage() && learningToolsEnabled && !hasMountedPanel()) {
    scheduleMount()
  }
}

const applyStartupSettings = async () => {
  if (startupSettingsApplied) {
    return
  }
  startupSettingsApplied = true

  const response = await sendRuntimeMessage<LearningSettings>({
    type: "GET_SETTINGS",
    payload: {}
  })
  if (!response.ok) {
    return
  }

  defaultLearningToolsEnabled = response.data.defaultLearningToolsEnabled
  if (defaultLearningToolsEnabled && isWatchPage()) {
    setLearningToolsEnabled(true)
  }
}

let contentScriptStarted = false
let pagePollTimer: number | null = null

const startContentScript = () => {
  if (contentScriptStarted) {
    return
  }

  if (!document.documentElement) {
    window.setTimeout(startContentScript, 50)
    return
  }

  contentScriptStarted = true

  document.addEventListener("yt-navigate-finish", () => {
    handlePageUpdate()
  })

  pagePollTimer = window.setInterval(handlePageUpdate, 1000)
  handlePageUpdate()
  void applyStartupSettings()
}

try {
  startContentScript()
} catch (error) {
  console.error("[yt-learning-tools] content script startup failed", error)
}

export default function Placeholder() {
  return null
}
