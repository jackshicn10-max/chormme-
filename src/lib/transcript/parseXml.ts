import type { CachedTranscriptSegment } from "~types"

const normalizeText = (text: string): string => {
  return text.replace(/\s+/g, " ").trim()
}

export const parseXmlTranscript = (xmlText: string): CachedTranscriptSegment[] => {
  const parser = new DOMParser()
  const documentXml = parser.parseFromString(xmlText, "text/xml")

  if (documentXml.querySelector("parsererror")) {
    return []
  }

  const rows = Array.from(documentXml.querySelectorAll("text"))

  return rows
    .map((row) => {
      const start = Number.parseFloat(row.getAttribute("start") ?? "0")
      const duration = Number.parseFloat(row.getAttribute("dur") ?? "0")
      const text = normalizeText(row.textContent ?? "")

      if (!text) {
        return null
      }

      return {
        start: Number.isFinite(start) ? Math.max(0, start) : 0,
        end:
          Number.isFinite(start) && Number.isFinite(duration)
            ? Math.max(start + 0.05, start + Math.max(0, duration))
            : Math.max(0.05, start + 0.05),
        text
      }
    })
    .filter((row): row is CachedTranscriptSegment => row !== null)
}

