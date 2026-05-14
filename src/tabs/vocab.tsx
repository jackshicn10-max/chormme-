import { useCallback, useEffect, useState } from "react"

import type { ExportVocabResponse } from "~lib/messages"
import { sendRuntimeMessage } from "~lib/messages"
import type { ExportFormat, VocabEntry } from "~types"

const downloadExport = (payload: ExportVocabResponse) => {
  const blob = new Blob([payload.content], { type: payload.mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = payload.filename
  anchor.click()
  URL.revokeObjectURL(url)
}

const VocabTab = () => {
  const selectedVideoId =
    new URLSearchParams(location.search).get("videoId")?.trim() || undefined
  const [items, setItems] = useState<VocabEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const response = await sendRuntimeMessage<VocabEntry[]>({
      type: "GET_RECENT_VOCAB",
      payload: { limit: 10000, videoId: selectedVideoId }
    })

    if (!response.ok) {
      setLoading(false)
      setError("error" in response ? response.error : "Failed to load vocab.")
      return
    }

    setItems(response.data)
    setLoading(false)
  }, [selectedVideoId])

  useEffect(() => {
    void load()
  }, [load])

  const handleExport = async (format: ExportFormat) => {
    const response = await sendRuntimeMessage<ExportVocabResponse>({
      type: "EXPORT_VOCAB",
      payload: { format, videoId: selectedVideoId }
    })

    if (!response.ok) {
      setError("error" in response ? response.error : "Failed to export vocab.")
      return
    }

    downloadExport(response.data)
  }

  return (
    <main
      style={{
        margin: "0 auto",
        maxWidth: 1100,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
        padding: "24px 20px",
        color: "#0f172a"
      }}>
      <h1 style={{ margin: "0 0 6px", fontSize: 24 }}>YouTube 生词本</h1>
      <p style={{ margin: "0 0 16px", color: "#475569" }}>
        保存规则：右键字幕单词立即写入本地词库（IndexedDB）。
      </p>

      {selectedVideoId && (
        <p style={{ margin: "0 0 16px", color: "#475569" }}>
          Current video only: {selectedVideoId}
        </p>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        <button type="button" onClick={() => void load()}>
          刷新
        </button>
        {selectedVideoId && (
          <button
            type="button"
            onClick={() => {
              location.href = "vocab.html"
            }}>
            Show all
          </button>
        )}
        <button type="button" onClick={() => void handleExport("csv")}>
          导出 CSV
        </button>
        <button type="button" onClick={() => void handleExport("json")}>
          导出 JSON
        </button>
      </div>

      {loading && <div>加载中...</div>}
      {!loading && error && <div style={{ color: "#b91c1c" }}>{error}</div>}
      {!loading && !error && items.length === 0 && (
        <div style={{ color: "#475569" }}>暂无保存记录。</div>
      )}

      {!loading && !error && items.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              border: "1px solid #e2e8f0"
            }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <th style={{ border: "1px solid #e2e8f0", padding: 8 }}>Word</th>
                <th style={{ border: "1px solid #e2e8f0", padding: 8 }}>Meaning</th>
                <th style={{ border: "1px solid #e2e8f0", padding: 8 }}>Sentence</th>
                <th style={{ border: "1px solid #e2e8f0", padding: 8 }}>Context</th>
                <th style={{ border: "1px solid #e2e8f0", padding: 8 }}>Video</th>
                <th style={{ border: "1px solid #e2e8f0", padding: 8 }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td style={{ border: "1px solid #e2e8f0", padding: 8 }}>{item.word}</td>
                  <td style={{ border: "1px solid #e2e8f0", padding: 8 }}>
                    {item.briefMeaning ?? ""}
                  </td>
                  <td style={{ border: "1px solid #e2e8f0", padding: 8 }}>
                    {item.sentence}
                  </td>
                  <td style={{ border: "1px solid #e2e8f0", padding: 8 }}>
                    {item.contextText}
                  </td>
                  <td style={{ border: "1px solid #e2e8f0", padding: 8 }}>
                    <a href={item.videoUrl} target="_blank" rel="noreferrer">
                      {item.videoTitle}
                    </a>
                  </td>
                  <td style={{ border: "1px solid #e2e8f0", padding: 8 }}>
                    {new Date(item.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}

export default VocabTab
