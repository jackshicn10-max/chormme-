export type CachedTranscriptSegment = {
  start: number
  end: number
  text: string
}

export type WordToken = {
  id: string
  surface: string
  normalized: string
  indexInSegment: number
}

export type TranscriptSegment = CachedTranscriptSegment & {
  id: string
  tokens: WordToken[]
}

export type VideoMeta = {
  platform: "youtube"
  videoId: string
  title: string
  url: string
  channelName?: string
}

export type TranscriptWindow = {
  sentence: string
  before: string[]
  after: string[]
  contextText: string
}

export type VocabEntry = {
  id: string
  word: string
  normalizedWord: string
  sentence: string
  contextText: string
  contextBefore: string[]
  contextAfter: string[]
  videoId: string
  videoTitle: string
  videoUrl: string
  timestamp: number
  segmentId: string
  briefMeaning: string | null
  detailedMeaning: string | null
  note: string
  createdAt: string
  updatedAt: string
}

export type SaveWordPayload = {
  word: string
  normalizedWord: string
  segmentId: string
  timestamp: number
  videoMeta: VideoMeta
  transcriptWindow: {
    sentence: string
    before: string[]
    after: string[]
  }
}

export type CachedTranscriptRecord = {
  videoId: string
  fetchedAt: string
  trackUrl: string
  segments: CachedTranscriptSegment[]
}

export type TranslationCacheEntry = {
  key: string
  normalizedWord: string
  createdAt: string
  value: string
}

export type LearningSettings = {
  defaultLearningToolsEnabled: boolean
  enableHoverTranslation: boolean
  enableTranslationPrewarm: boolean
  captionLeadSeconds: number
  manualTranslationPrewarmScope: "next20m" | "remaining"
  manualTranslationPrewarmWordLimit: 720 | 1440 | 2160 | 2880
}

export type ExportFormat = "csv" | "json"
