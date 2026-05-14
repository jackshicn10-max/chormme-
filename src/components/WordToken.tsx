import { useRef, useState } from "react"
import { createPortal } from "react-dom"

import {
  sendRuntimeMessage,
  type WordTranslationResponse
} from "~lib/messages"
import type { WordToken as WordTokenType } from "~types"

type WordTokenProps = {
  token: WordTokenType
  isSaved: boolean
  translationEnabled: boolean
  onSave: (token: WordTokenType) => void
}

type TooltipState = {
  left: number
  top: number
  meaning: string
  loading: boolean
}

const TOOLTIP_WIDTH = 300

const getTooltipPosition = (element: HTMLElement) => {
  const rect = element.getBoundingClientRect()
  const left = Math.min(
    window.innerWidth - TOOLTIP_WIDTH - 12,
    Math.max(12, rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2)
  )
  const topAbove = rect.top - 78
  const top = topAbove >= 12 ? topAbove : rect.bottom + 10

  return { left, top }
}

export const WordToken = ({
  token,
  isSaved,
  translationEnabled,
  onSave
}: WordTokenProps) => {
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const clearHoverTimer = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }

  const hideTooltip = () => {
    clearHoverTimer()
    requestIdRef.current += 1
    setTooltip(null)
  }

  const showTooltip = (element: HTMLElement) => {
    if (!translationEnabled) {
      return
    }

    clearHoverTimer()
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const position = getTooltipPosition(element)

    setTooltip({
      ...position,
      meaning: "查询中...",
      loading: true
    })

    hoverTimerRef.current = setTimeout(() => {
      void (async () => {
        const response = await sendRuntimeMessage<WordTranslationResponse>(
          {
            type: "GET_WORD_TRANSLATION",
            payload: { word: token.surface }
          },
          6000
        )

        if (requestIdRef.current !== requestId) {
          return
        }

        setTooltip({
          ...getTooltipPosition(element),
          meaning: response.ok ? response.data.briefMeaning : "暂无释义",
          loading: false
        })
      })()
    }, 90)
  }

  const tooltipNode =
    tooltip && document.body
      ? createPortal(
          <div
            style={{
              position: "fixed",
              left: tooltip.left,
              top: tooltip.top,
              zIndex: 2147483647,
              width: TOOLTIP_WIDTH,
              pointerEvents: "none",
              borderRadius: 10,
              padding: "10px 12px",
              color: "#f8fafc",
              background: "rgba(17, 24, 39, 0.94)",
              boxShadow: "0 14px 34px rgba(0, 0, 0, 0.32)",
              fontSize: 15,
              lineHeight: 1.5
            }}>
            <div
              style={{
                color: "#bbf7d0",
                fontWeight: 700,
                marginBottom: 4
              }}>
              {token.surface}
              <span style={{ color: "#e5e7eb", fontWeight: 500 }}>： </span>
              <span style={{ color: "#fef08a", fontWeight: 650 }}>
                {tooltip.meaning}
              </span>
            </div>
            <div
              style={{
                color: "rgba(226, 232, 240, 0.78)",
                fontSize: 12
              }}>
              {tooltip.loading ? "正在获取中文释义" : "右键可加入生词本"}
            </div>
          </div>,
          document.body
        )
      : null

  return (
    <>
      <span
        role="button"
        tabIndex={-1}
        onMouseEnter={(event) => showTooltip(event.currentTarget)}
        onMouseLeave={hideTooltip}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onSave(token)
        }}
        style={{
          cursor: translationEnabled ? "help" : "context-menu",
          borderRadius: 4,
          padding: "0 1px",
          fontWeight: isSaved ? 600 : 400,
          background: isSaved ? "rgba(34, 197, 94, 0.15)" : "transparent",
          borderBottom: isSaved ? "1px solid rgba(22, 163, 74, 0.45)" : "none"
        }}>
        {token.surface}
      </span>
      {tooltipNode}
    </>
  )
}
