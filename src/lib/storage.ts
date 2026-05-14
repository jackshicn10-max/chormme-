import Dexie, { type Table } from "dexie"

import type {
  CachedTranscriptRecord,
  TranslationCacheEntry,
  VocabEntry
} from "~types"

class LearningDatabase extends Dexie {
  vocab!: Table<VocabEntry, string>
  transcripts!: Table<CachedTranscriptRecord, string>
  translationCache!: Table<TranslationCacheEntry, string>

  constructor() {
    super("youtube-english-learning-tools")
    this.version(1).stores({
      vocab: "id, normalizedWord, videoId, createdAt, timestamp",
      transcripts: "videoId, fetchedAt",
      translationCache: "key, normalizedWord, createdAt"
    })
    this.version(2).stores({
      vocab:
        "id, normalizedWord, videoId, [videoId+normalizedWord], createdAt, timestamp",
      transcripts: "videoId, fetchedAt",
      translationCache: "key, normalizedWord, createdAt"
    })
  }
}

export const db = new LearningDatabase()

const sortNewestFirst = (entries: VocabEntry[]): VocabEntry[] => {
  return [...entries].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  )
}

const dedupeVocabEntries = (entries: VocabEntry[]): VocabEntry[] => {
  const seen = new Set<string>()
  const deduped: VocabEntry[] = []

  for (const entry of sortNewestFirst(entries)) {
    const key = `${entry.videoId}\u0000${entry.normalizedWord}`
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    deduped.push(entry)
  }

  return deduped
}

const findVocabEntriesByVideoWord = async (
  videoId: string,
  normalizedWord: string
): Promise<VocabEntry[]> => {
  return db.vocab
    .where("[videoId+normalizedWord]")
    .equals([videoId, normalizedWord])
    .toArray()
}

export const saveVocabEntry = async (
  entry: VocabEntry
): Promise<VocabEntry> => {
  const existingEntries = await findVocabEntriesByVideoWord(
    entry.videoId,
    entry.normalizedWord
  )
  const existing = sortNewestFirst(existingEntries)[0]

  if (!existing) {
    await db.vocab.put(entry)
    return entry
  }

  const next: VocabEntry = {
    ...existing,
    word: entry.word,
    sentence: entry.sentence,
    contextText: entry.contextText,
    contextBefore: entry.contextBefore,
    contextAfter: entry.contextAfter,
    videoTitle: entry.videoTitle,
    videoUrl: entry.videoUrl,
    timestamp: entry.timestamp,
    segmentId: entry.segmentId,
    briefMeaning: entry.briefMeaning ?? existing.briefMeaning,
    detailedMeaning: entry.detailedMeaning ?? existing.detailedMeaning,
    updatedAt: entry.updatedAt
  }

  await db.vocab.put(next)
  return next
}

export const listRecentVocab = async (
  limit: number,
  videoId?: string
): Promise<VocabEntry[]> => {
  if (limit <= 0) {
    return []
  }

  const records = videoId
    ? await db.vocab.where("videoId").equals(videoId).toArray()
    : await db.vocab.orderBy("createdAt").reverse().toArray()

  return dedupeVocabEntries(records).slice(0, limit)
}

export const listAllVocab = async (
  videoId?: string
): Promise<VocabEntry[]> => {
  const records = videoId
    ? await db.vocab.where("videoId").equals(videoId).toArray()
    : await db.vocab.orderBy("createdAt").reverse().toArray()

  return dedupeVocabEntries(records)
}

export const getCachedTranscript = async (
  videoId: string
): Promise<CachedTranscriptRecord | undefined> => {
  return db.transcripts.get(videoId)
}

export const saveCachedTranscript = async (
  record: CachedTranscriptRecord
): Promise<void> => {
  await db.transcripts.put(record)
}

export const getTranslationCache = async (
  key: string
): Promise<TranslationCacheEntry | undefined> => {
  return db.translationCache.get(key)
}

export const saveTranslationCache = async (
  entry: TranslationCacheEntry
): Promise<void> => {
  await db.translationCache.put(entry)
}

export const clearTranslationCache = async (): Promise<void> => {
  await db.translationCache.clear()
}
