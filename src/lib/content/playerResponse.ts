import { requestMainWorld } from "~lib/mainWorldBridge"

const extractJsonObjectAfterMarker = (
  sourceText: string,
  marker: string
): unknown | null => {
  const markerIndex = sourceText.indexOf(marker)
  if (markerIndex < 0) {
    return null
  }

  const assignIndex = sourceText.indexOf("=", markerIndex)
  if (assignIndex < 0) {
    return null
  }

  const firstBrace = sourceText.indexOf("{", assignIndex)
  if (firstBrace < 0) {
    return null
  }

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = firstBrace; i < sourceText.length; i += 1) {
    const char = sourceText[i]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === "\\") {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === "{") {
      depth += 1
      continue
    }

    if (char === "}") {
      depth -= 1
      if (depth === 0) {
        const jsonText = sourceText.slice(firstBrace, i + 1)
        try {
          return JSON.parse(jsonText)
        } catch {
          return null
        }
      }
    }
  }

  return null
}

const readFromScriptTags = (): unknown | null => {
  const scripts = Array.from(document.querySelectorAll("script"))
  for (const script of scripts) {
    const text = script.textContent
    if (!text || !text.includes("ytInitialPlayerResponse")) {
      continue
    }

    const parsed = extractJsonObjectAfterMarker(text, "ytInitialPlayerResponse")
    if (parsed) {
      return parsed
    }
  }

  return null
}

const readFromMainWorld = async (): Promise<unknown | null> => {
  try {
    return await requestMainWorld<unknown | null>("GET_PLAYER_RESPONSE")
  } catch {
    return null
  }
}

const readFromHtmlText = (htmlText: string): unknown | null => {
  return extractJsonObjectAfterMarker(htmlText, "ytInitialPlayerResponse")
}

const readFromFetchedHtml = async (): Promise<unknown | null> => {
  try {
    const response = await fetch(window.location.href, {
      credentials: "include",
      cache: "no-store"
    })
    if (!response.ok) {
      return null
    }

    const htmlText = await response.text()
    if (!htmlText) {
      return null
    }

    return readFromHtmlText(htmlText)
  } catch {
    return null
  }
}

export const readInitialPlayerResponse = async (): Promise<unknown | null> => {
  const fromScriptText = readFromScriptTags()
  if (fromScriptText) {
    return fromScriptText
  }

  const fromMainWorld = await readFromMainWorld()
  if (fromMainWorld) {
    return fromMainWorld
  }

  return readFromFetchedHtml()
}

