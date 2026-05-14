import { BUNDLED_TRANSLATIONS } from "~lib/translation/bundledDictionary"
import { ECDICT_TRANSLATIONS } from "~lib/translation/ecdictDictionary.generated"

export type WordTranslationSource = "local" | "online" | "fallback"

export type ResolvedWordTranslation = {
  normalizedWord: string
  briefMeaning: string
  source: WordTranslationSource
}

export const FALLBACK_TRANSLATION = "暂无释义"

export const normalizeLookupWord = (word: string): string => {
  return word
    .replace(/[’`]/g, "'")
    .toLowerCase()
    .replace(/^[^a-z]+|[^a-z]+$/g, "")
    .trim()
}

const getLookupCandidates = (normalizedWord: string): string[] => {
  const candidates = new Set<string>()
  const add = (value: string) => {
    const clean = normalizeLookupWord(value)
    if (clean) {
      candidates.add(clean)
    }
  }

  add(normalizedWord)

  if (normalizedWord.endsWith("'s")) {
    add(normalizedWord.slice(0, -2))
  }
  if (normalizedWord.endsWith("ies") && normalizedWord.length > 4) {
    add(`${normalizedWord.slice(0, -3)}y`)
  }
  if (normalizedWord.endsWith("ing") && normalizedWord.length > 5) {
    const stem = normalizedWord.slice(0, -3)
    add(stem)
    add(`${stem}e`)
  }
  if (normalizedWord.endsWith("ed") && normalizedWord.length > 4) {
    const stem = normalizedWord.slice(0, -2)
    add(stem)
    add(`${stem}e`)
  }
  if (normalizedWord.endsWith("s") && normalizedWord.length > 3) {
    add(normalizedWord.slice(0, -1))
  }

  return Array.from(candidates)
}

export const lookupBundledTranslation = (
  normalizedWord: string
): string | null => {
  for (const candidate of getLookupCandidates(normalizedWord)) {
    const meaning = BUNDLED_TRANSLATIONS[candidate] ?? ECDICT_TRANSLATIONS[candidate]
    if (meaning) {
      return meaning
    }
  }

  return null
}

const cleanOnlineTranslation = (
  normalizedWord: string,
  value: unknown
): string | null => {
  if (typeof value !== "string") {
    return null
  }

  const text = value.replace(/\s+/g, " ").trim()
  if (!text || text.toLowerCase() === normalizedWord) {
    return null
  }
  if (/^[a-z' -]+$/i.test(text)) {
    return null
  }

  return text
}

const fetchOnlineTranslation = async (
  normalizedWord: string
): Promise<string | null> => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 3500)

  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
      normalizedWord
    )}&langpair=en|zh-CN`
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal
    })

    if (!response.ok) {
      return null
    }

    const payload = (await response.json()) as {
      responseData?: { translatedText?: unknown }
      matches?: Array<{ translation?: unknown }>
    }
    const direct = cleanOnlineTranslation(
      normalizedWord,
      payload.responseData?.translatedText
    )
    if (direct) {
      return direct
    }

    for (const match of payload.matches ?? []) {
      const candidate = cleanOnlineTranslation(normalizedWord, match.translation)
      if (candidate) {
        return candidate
      }
    }

    return null
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

export const resolveWordTranslation = async (
  word: string
): Promise<ResolvedWordTranslation> => {
  const normalizedWord = normalizeLookupWord(word)
  if (!normalizedWord) {
    return {
      normalizedWord: "",
      briefMeaning: FALLBACK_TRANSLATION,
      source: "fallback"
    }
  }

  const localMeaning = lookupBundledTranslation(normalizedWord)
  if (localMeaning) {
    return {
      normalizedWord,
      briefMeaning: localMeaning,
      source: "local"
    }
  }

  const onlineMeaning = await fetchOnlineTranslation(normalizedWord)
  if (onlineMeaning) {
    return {
      normalizedWord,
      briefMeaning: onlineMeaning,
      source: "online"
    }
  }

  return {
    normalizedWord,
    briefMeaning: FALLBACK_TRANSLATION,
    source: "fallback"
  }
}
