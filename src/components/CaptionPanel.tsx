import { useEffect, useMemo, useRef } from "react"

import { CaptionRow } from "~components/CaptionRow"
import { Toast } from "~components/Toast"
import type { TranscriptSegment, VideoMeta, WordToken } from "~types"

type CaptionPanelProps = {
  open: boolean
  loading: boolean
  error: string | null
  videoMeta: VideoMeta
  segments: TranscriptSegment[]
  activeSegmentId: string | null
  savedWords: Set<string>
  translationEnabled: boolean
  toast: string | null
  trackLabel?: string | null
  onToggleOpen: () => void
  onOpenVocab: () => void
  onOpenSettings: () => void
  onRefresh?: () => void
  onPrewarmTranslations?: () => void
  prewarmStatus?: string | null
  prewarmLoading?: boolean
  onSeek: (segment: TranscriptSegment) => void
  onSaveWord: (token: WordToken, segment: TranscriptSegment) => void
}

const buttonStyle = {
  border: "1px solid rgba(15, 23, 42, 0.18)",
  borderRadius: 8,
  padding: "4px 8px",
  fontSize: 12,
  cursor: "pointer",
  background: "#fff",
  color: "#0f172a"
}

export const CaptionPanel = ({
  open,
  loading,
  error,
  videoMeta,
  segments,
  activeSegmentId,
  savedWords,
  translationEnabled,
  toast,
  trackLabel,
  onToggleOpen,
  onOpenVocab,
  onOpenSettings,
  onRefresh,
  onPrewarmTranslations,
  prewarmStatus,
  prewarmLoading = false,
  onSeek,
  onSaveWord
}: CaptionPanelProps) => {
  const rowRefs = useRef(new Map<string, HTMLDivElement>())

  useEffect(() => {
    if (!activeSegmentId) {
      return
    }

    const node = rowRefs.current.get(activeSegmentId)
    if (!node) {
      return
    }

    node.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [activeSegmentId])

  const title = useMemo(() => {
    return videoMeta.title || "YouTube 字幕面板"
  }, [videoMeta.title])

  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggleOpen}
        style={{
          position: "fixed",
          right: 12,
          top: 120,
          zIndex: 999998,
          border: "1px solid rgba(30, 41, 59, 0.2)",
          borderRadius: 8,
          background: "#ffffff",
          color: "#0f172a",
          padding: "8px 10px",
          cursor: "pointer",
          boxShadow: "0 8px 28px rgba(2, 6, 23, 0.15)"
        }}>
        打开字幕面板
      </button>
    )
  }

  return (
    <section
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      style={{
        position: "fixed",
        top: 64,
        right: 12,
        width: 420,
        maxHeight: "calc(100vh - 76px)",
        zIndex: 999998,
        display: "flex",
        flexDirection: "column",
        borderRadius: 12,
        border: "1px solid rgba(148, 163, 184, 0.35)",
        background: "rgba(255, 255, 255, 0.97)",
        boxShadow: "0 24px 60px rgba(2, 6, 23, 0.23)",
        overflow: "hidden"
      }}>
      <header
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: "10px 12px",
          borderBottom: "1px solid rgba(203, 213, 225, 0.8)",
          background:
            "linear-gradient(110deg, rgba(226, 232, 240, 0.45), rgba(248, 250, 252, 0.9))"
        }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "#0f172a",
            lineHeight: 1.3
          }}>
          {title}
        </div>
        {trackLabel && (
          <div style={{ fontSize: 12, color: "#64748b" }}>当前字幕：{trackLabel}</div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" onClick={onOpenVocab} style={buttonStyle}>
            打开生词本
          </button>
          <button type="button" onClick={onOpenSettings} style={buttonStyle}>
            设置
          </button>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              style={{
                ...buttonStyle,
                opacity: loading ? 0.55 : 1,
                cursor: loading ? "not-allowed" : "pointer"
              }}>
              {loading ? "刷新中" : "刷新字幕"}
            </button>
          )}
          {onPrewarmTranslations && (
            <button
              type="button"
              onClick={onPrewarmTranslations}
              disabled={loading || prewarmLoading}
              style={{
                ...buttonStyle,
                opacity: loading || prewarmLoading ? 0.55 : 1,
                cursor: loading || prewarmLoading ? "not-allowed" : "pointer"
              }}>
              {prewarmLoading ? "预热中" : "预热释义"}
            </button>
          )}
          <button type="button" onClick={onToggleOpen} style={buttonStyle}>
            关闭
          </button>
        </div>
        {prewarmStatus && (
          <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.35 }}>
            {prewarmStatus}
          </div>
        )}
      </header>

      <div
        style={{
          overflowY: "auto",
          padding: 10,
          fontSize: 14,
          color: "#0f172a",
          minHeight: 140
        }}>
        {loading && <div style={{ color: "#475569" }}>正在加载英文字幕...</div>}
        {!loading && error && (
          <div style={{ color: "#b91c1c", whiteSpace: "pre-wrap" }}>{error}</div>
        )}
        {!loading && !error && segments.length === 0 && (
          <div style={{ color: "#475569" }}>未找到可显示的字幕内容。</div>
        )}
        {!loading &&
          !error &&
          segments.map((segment) => (
            <CaptionRow
              key={segment.id}
              segment={segment}
              active={activeSegmentId === segment.id}
              savedWords={savedWords}
              translationEnabled={translationEnabled}
              onSeek={onSeek}
              onSaveWord={onSaveWord}
              rowRef={(node) => {
                if (node) {
                  rowRefs.current.set(segment.id, node)
                } else {
                  rowRefs.current.delete(segment.id)
                }
              }}
            />
          ))}
      </div>

      {toast && <Toast message={toast} />}
    </section>
  )
}
