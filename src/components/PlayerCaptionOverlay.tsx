import { useEffect, useState } from "react"
import { createPortal } from "react-dom"

import type { TranscriptSegment } from "~types"

const OVERLAY_HOST_ID = "yt-learning-tools-player-caption-overlay"
const HIDE_NATIVE_STYLE_ID = "yt-learning-tools-hide-native-caption-style"
const HIDE_NATIVE_CLASS = "yt-learning-tools-hide-native-captions"

const findPlayerElement = (video: HTMLVideoElement): HTMLElement | null => {
  return (
    (video.closest(".html5-video-player") as HTMLElement | null) ??
    document.querySelector<HTMLElement>(".html5-video-player")
  )
}

const ensureHideNativeStyle = () => {
  if (document.getElementById(HIDE_NATIVE_STYLE_ID)) {
    return
  }

  const style = document.createElement("style")
  style.id = HIDE_NATIVE_STYLE_ID
  style.textContent = `
    .${HIDE_NATIVE_CLASS} .ytp-caption-window-container,
    .${HIDE_NATIVE_CLASS} .caption-window,
    .${HIDE_NATIVE_CLASS} .ytp-caption-segment {
      visibility: hidden !important;
    }
  `
  document.head.appendChild(style)
}

type PlayerCaptionOverlayProps = {
  video: HTMLVideoElement
  segment: TranscriptSegment | null
}

export const PlayerCaptionOverlay = ({
  video,
  segment
}: PlayerCaptionOverlayProps) => {
  const [host, setHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const player = findPlayerElement(video)
    if (!player) {
      return
    }

    ensureHideNativeStyle()
    player.classList.add(HIDE_NATIVE_CLASS)

    let overlayHost = player.querySelector<HTMLElement>(`#${OVERLAY_HOST_ID}`)
    if (!overlayHost) {
      overlayHost = document.createElement("div")
      overlayHost.id = OVERLAY_HOST_ID
      player.appendChild(overlayHost)
    }

    Object.assign(overlayHost.style, {
      position: "absolute",
      left: "0",
      right: "0",
      bottom: "70px",
      zIndex: "65",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      boxSizing: "border-box",
      padding: "0 8%",
      pointerEvents: "none"
    } satisfies Partial<CSSStyleDeclaration>)

    setHost(overlayHost)

    return () => {
      player.classList.remove(HIDE_NATIVE_CLASS)
      overlayHost?.remove()
      setHost(null)
    }
  }, [video])

  if (!host || !segment?.text) {
    return null
  }

  return createPortal(
    <div
      style={{
        maxWidth: "min(980px, 100%)",
        color: "#fff",
        background: "rgba(0, 0, 0, 0.62)",
        borderRadius: 4,
        padding: "4px 10px 5px",
        fontSize: "clamp(20px, 2.25vw, 31px)",
        lineHeight: 1.22,
        fontWeight: 650,
        letterSpacing: "0.01em",
        textAlign: "center",
        textShadow: "0 2px 3px rgba(0, 0, 0, 0.85)",
        boxDecorationBreak: "clone",
        WebkitBoxDecorationBreak: "clone",
        display: "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical",
        overflow: "hidden"
      }}>
      {segment.text}
    </div>,
    host
  )
}
