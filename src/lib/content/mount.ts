import type { ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"

const PANEL_HOST_ID = "yt-learning-tools-panel-host"

let panelRoot: Root | null = null
let panelHost: HTMLElement | null = null

const createHost = (): HTMLElement => {
  const host = document.createElement("div")
  host.id = PANEL_HOST_ID

  const secondary = document.querySelector<HTMLElement>("#secondary")
  if (secondary) {
    secondary.prepend(host)
  } else {
    host.style.position = "fixed"
    host.style.top = "0"
    host.style.right = "0"
    host.style.zIndex = "999998"
    document.body.appendChild(host)
  }

  return host
}

export const mountPanel = (element: ReactElement) => {
  unmountPanel()
  panelHost = createHost()
  panelRoot = createRoot(panelHost)
  panelRoot.render(element)
}

export const unmountPanel = () => {
  if (panelRoot) {
    panelRoot.unmount()
    panelRoot = null
  }

  if (panelHost) {
    panelHost.remove()
    panelHost = null
  }
}

export const hasMountedPanel = (): boolean => {
  return Boolean(document.getElementById(PANEL_HOST_ID))
}

