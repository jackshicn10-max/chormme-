import { spawn } from "node:child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")
const extensionPath = path.resolve(
  process.env.QA_EXTENSION_PATH ?? path.resolve(root, "build", "chrome-mv3-prod")
)
const outputDir = path.resolve(root, "output", "chrome-qa")
const profileDir = path.resolve(os.tmpdir(), "yt-learning-tools-chrome-qa-profile")
const targetUrl =
  process.env.QA_URL ?? "https://youtube.com/watch?v=7xTGNNLPyMI&t=869s"
const waitMs = Number.parseInt(process.env.QA_WAIT_MS ?? "45000", 10)

const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const getFreePort = async () =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : null
      server.close(() => {
        if (port) {
          resolve(port)
        } else {
          reject(new Error("Failed to allocate a debugging port."))
        }
      })
    })
    server.on("error", reject)
  })

const fetchJson = async (url, init) => {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`)
  }
  return response.json()
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.nextId = 1
    this.pending = new Map()
    this.handlers = new Map()
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl)
      this.ws.addEventListener("open", resolve, { once: true })
      this.ws.addEventListener("error", reject, { once: true })
      this.ws.addEventListener("message", (event) => {
        const message = JSON.parse(event.data)
        if (message.id) {
          const pending = this.pending.get(message.id)
          if (!pending) {
            return
          }
          this.pending.delete(message.id)
          if (message.error) {
            pending.reject(new Error(message.error.message))
          } else {
            pending.resolve(message.result)
          }
          return
        }

        const listeners = this.handlers.get(message.method) ?? []
        for (const listener of listeners) {
          listener(message.params)
        }
      })
    })
  }

  on(method, listener) {
    const listeners = this.handlers.get(method) ?? []
    listeners.push(listener)
    this.handlers.set(method, listeners)
  }

  send(method, params = {}) {
    const id = this.nextId++
    const payload = JSON.stringify({ id, method, params })
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(payload)
    })
  }

  close() {
    this.ws?.close()
  }
}

const evaluate = async (client, expression) => {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  })

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Runtime.evaluate failed")
  }

  return result.result?.value
}

const main = async () => {
  if (!existsSync(extensionPath)) {
    throw new Error(`Extension build not found: ${extensionPath}`)
  }

  const chromePath = chromeCandidates.find((candidate) => existsSync(candidate))
  if (!chromePath) {
    throw new Error("No Chrome or Edge executable found.")
  }

  mkdirSync(outputDir, { recursive: true })
  rmSync(profileDir, { recursive: true, force: true })
  mkdirSync(profileDir, { recursive: true })

  const port = await getFreePort()
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-popup-blocking",
    "--lang=en-US",
    "--window-size=1600,1000",
    "about:blank"
  ]

  console.log(JSON.stringify({ chromePath, extensionPath, targetUrl, port }, null, 2))

  const chrome = spawn(chromePath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false
  })

  let stderr = ""
  chrome.stderr.on("data", (chunk) => {
    stderr += chunk.toString()
  })

  try {
    let version = null
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        version = await fetchJson(`http://127.0.0.1:${port}/json/version`)
        break
      } catch {
        await sleep(250)
      }
    }
    if (!version) {
      throw new Error("Chrome DevTools endpoint did not start.")
    }

    await sleep(Number.parseInt(process.env.QA_EXTENSION_BOOT_MS ?? "2500", 10))

    const browser = new CdpClient(version.webSocketDebuggerUrl)
    await browser.connect()
    const targetsBefore = await browser.send("Target.getTargets")

    const newTarget = await fetchJson(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`,
      { method: "PUT" }
    )
    const page = new CdpClient(newTarget.webSocketDebuggerUrl)
    await page.connect()

    const consoleEvents = []
    const networkFailures = []
    const requestUrls = new Map()
    const exceptions = []

    page.on("Runtime.consoleAPICalled", (params) => {
      consoleEvents.push({
        type: params.type,
        text: (params.args ?? []).map((arg) => arg.value ?? arg.description).join(" ")
      })
    })
    page.on("Runtime.exceptionThrown", (params) => {
      exceptions.push(params.exceptionDetails?.text ?? "Runtime exception")
    })
    page.on("Log.entryAdded", (params) => {
      consoleEvents.push({
        type: params.entry?.level ?? "log",
        text: params.entry?.text ?? ""
      })
    })
    page.on("Network.loadingFailed", (params) => {
      const request = requestUrls.get(params.requestId)
      networkFailures.push({
        url: request?.url ?? params.requestId,
        errorText: params.errorText,
        blockedReason: params.blockedReason ?? null
      })
    })
    page.on("Network.requestWillBeSent", (params) => {
      requestUrls.set(params.requestId, {
        url: params.request?.url ?? "",
        method: params.request?.method ?? "",
        postData: params.request?.postData ?? ""
      })
    })

    await page.send("Runtime.enable")
    await page.send("Page.enable")
    await page.send("Log.enable")
    await page.send("Network.enable")

    await page.send("Page.navigate", { url: targetUrl })
    await sleep(waitMs)

    const toggleProbe = await evaluate(
      page,
      `(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        let button = null
        for (let attempt = 0; attempt < 80; attempt += 1) {
          button = document.querySelector("#yt-learning-tools-toggle-button")
          if (button) {
            break
          }
          await sleep(250)
        }
        if (!button) {
          return { buttonExists: false, clicked: false, text: null }
        }
        const beforeText = button.textContent
        if (!/ON/i.test(beforeText ?? "")) {
          button.click()
        }
        await sleep(Number.parseInt("${process.env.QA_AFTER_TOGGLE_MS ?? "15000"}", 10))
        return {
          buttonExists: true,
          clicked: !/ON/i.test(beforeText ?? ""),
          beforeText,
          afterText: button.textContent,
          panelTextStart:
            document
              .querySelector("#yt-learning-tools-panel-host")
              ?.innerText?.slice(0, 1200) ?? ""
        }
      })()`
    )

    if (process.env.QA_SMOKE === "1") {
      const state = await evaluate(
        page,
        `(() => {
          const host = document.querySelector("#yt-learning-tools-panel-host")
          const toggle = document.querySelector("#yt-learning-tools-toggle-button")
          return {
            href: location.href,
            title: document.title,
            readyState: document.readyState,
            toggleExists: Boolean(toggle),
            toggleText: toggle?.textContent ?? null,
            hostExists: Boolean(host),
            hostText: host?.innerText?.slice(0, 2000) ?? "",
            videoExists: Boolean(document.querySelector("video")),
            secondaryExists: Boolean(document.querySelector("#secondary")),
            bodyTextStart: document.body?.innerText?.slice(0, 800) ?? ""
          }
        })()`
      )

      const screenshot = await page.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false
      })
      const screenshotPath = path.resolve(outputDir, "youtube-extension.png")
      writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"))

      const reportPath = path.resolve(outputDir, "youtube-extension-report.json")
      writeFileSync(
        reportPath,
        JSON.stringify(
          {
            state,
            toggleProbe,
            consoleEvents: consoleEvents.slice(-80),
            exceptions,
            networkFailures: networkFailures.slice(-80),
            screenshotPath,
            chromeStderrTail: stderr.slice(-3000)
          },
          null,
          2
        )
      )
      console.log(JSON.stringify({ reportPath, screenshotPath, state }, null, 2))
      page.close()
      browser.close()
      return
    }

    const nativeTranscriptUiProbe = await evaluate(
      page,
      `(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const normalize = (text) => (text ?? "").replace(/\\s+/g, " ").trim()
        const elementText = (element) =>
          normalize(
            element.innerText ||
              element.textContent ||
              element.getAttribute("aria-label") ||
              ""
          )
        const clickableSelector = [
          "button",
          "tp-yt-paper-button",
          "yt-button-shape button",
          "ytd-button-renderer button",
          "a",
          "[role='button']"
        ].join(",")
        const visible = (element) => {
          const rect = element.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        }
        const listCandidates = (regex) =>
          Array.from(document.querySelectorAll(clickableSelector))
            .filter(visible)
            .map((element) => ({ text: elementText(element), tag: element.tagName }))
            .filter((item) => item.text && (!regex || regex.test(item.text)))
            .slice(0, 30)
        const clickFirst = async (regex) => {
          const elements = Array.from(document.querySelectorAll(clickableSelector))
          for (const element of elements) {
            if (!visible(element)) {
              continue
            }
            const text = elementText(element)
            if (!regex.test(text)) {
              continue
            }
            element.scrollIntoView({ block: "center" })
            await sleep(300)
            element.click()
            return text
          }
          return null
        }

        window.__ytLearningFetchLog = []
        if (!window.__ytLearningFetchPatched) {
          const originalFetch = window.fetch.bind(window)
          window.fetch = async (...args) => {
            const requestUrl =
              typeof args[0] === "string"
                ? args[0]
                : args[0]?.url ?? String(args[0])
            const init = args[1] ?? {}
            const shouldLog = String(requestUrl).includes("get_transcript")
            const response = await originalFetch(...args)
            if (shouldLog) {
              const clone = response.clone()
              let text = ""
              try {
                text = await clone.text()
              } catch {}
              window.__ytLearningFetchLog.push({
                url: String(requestUrl),
                method: init.method ?? "GET",
                bodyStart: typeof init.body === "string" ? init.body.slice(0, 1200) : "",
                status: response.status,
                textStart: text.slice(0, 1200)
              })
            }
            return response
          }
          window.__ytLearningFetchPatched = true
        }

        const beforeTranscriptCandidates = listCandidates(/transcript|文字|字幕/i)

        document
          .querySelector(
            "#description-inline-expander tp-yt-paper-button#expand, ytd-text-inline-expander tp-yt-paper-button#expand, #expand"
          )
          ?.click()
        await sleep(1200)
        window.scrollBy({ top: 500, behavior: "instant" })
        await sleep(800)

        const afterExpandCandidates = listCandidates(/transcript|文字|字幕|show more|more/i)
        const clicked =
          (await clickFirst(/show transcript|transcript|文字记录|显示文字|字幕/i)) ??
          (await clickFirst(/transcript/i))
        await sleep(clicked ? 8000 : 1000)

        const nativePanel = document.querySelector(
          "ytd-transcript-renderer, ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-searchable-transcript']"
        )
        const nativeSegments = Array.from(
          document.querySelectorAll("ytd-transcript-segment-renderer")
        )
          .map((node) => normalize(node.innerText || node.textContent || ""))
          .filter(Boolean)
          .slice(0, 12)

        return {
          beforeTranscriptCandidates,
          afterExpandCandidates,
          clicked,
          nativePanelExists: Boolean(nativePanel),
          nativePanelTextStart: normalize(nativePanel?.innerText ?? "").slice(0, 1600),
          nativeSegmentCount: document.querySelectorAll("ytd-transcript-segment-renderer").length,
          nativeSegments,
          fetchLog: window.__ytLearningFetchLog
        }
      })()`
    )

    const playerCaptionProbe = await evaluate(
      page,
      `(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const before = new Set(
          performance
            .getEntriesByType("resource")
            .map((entry) => entry.name)
            .filter((name) => name.includes("/api/timedtext"))
        )
        const button = document.querySelector(".ytp-subtitles-button")
        const beforePressed = button?.getAttribute("aria-pressed") ?? null
        if (button && beforePressed !== "true") {
          button.click()
        }
        await sleep(8000)
        const afterUrls = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((name) => name.includes("/api/timedtext"))
        const newUrls = Array.from(new Set(afterUrls.filter((url) => !before.has(url))))
        const captionText = Array.from(document.querySelectorAll(".ytp-caption-segment"))
          .map((node) => (node.textContent ?? "").trim())
          .filter(Boolean)
          .join(" ")
        const fetchResults = []
        for (const url of newUrls.slice(-8)) {
          try {
            const response = await fetch(url, {
              credentials: "include",
              cache: "no-store"
            })
            const text = await response.text()
            fetchResults.push({
              urlStart: url.slice(0, 500),
              status: response.status,
              ok: response.ok,
              length: text.length,
              textStart: text.slice(0, 700)
            })
          } catch (error) {
            fetchResults.push({
              urlStart: url.slice(0, 500),
              error: error instanceof Error ? error.message : String(error)
            })
          }
        }
        return {
          buttonExists: Boolean(button),
          beforePressed,
          afterPressed: button?.getAttribute("aria-pressed") ?? null,
          captionText,
          newTimedtextUrlCount: newUrls.length,
          newTimedtextUrlsStart: newUrls.slice(-10).map((url) => url.slice(0, 500)),
          fetchResults
        }
      })()`
    )

    const state = await evaluate(
      page,
      `(() => {
        const host = document.querySelector("#yt-learning-tools-panel-host")
        const section = host?.querySelector("section")
        const text = host?.innerText ?? ""
        const tracks =
          window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
        return {
          href: location.href,
          title: document.title,
          readyState: document.readyState,
          bodyTextStart: document.body?.innerText?.slice(0, 1200) ?? "",
          hostExists: Boolean(host),
          hostText: text.slice(0, 3000),
          hostHtmlStart: host?.outerHTML?.slice(0, 3000) ?? null,
          panelSectionExists: Boolean(section),
          videoExists: Boolean(document.querySelector("video")),
          secondaryExists: Boolean(document.querySelector("#secondary")),
          ytcfgApiKeyExists: Boolean(window.ytcfg?.get?.("INNERTUBE_API_KEY")),
          ytInitialPlayerResponseExists: Boolean(window.ytInitialPlayerResponse),
          captionTrackCount: tracks.length,
          captionTracks: tracks.map((track) => ({
            languageCode: track.languageCode,
            kind: track.kind ?? null,
            name:
              track.name?.simpleText ??
              track.name?.runs?.map((run) => run.text).join("") ??
              "",
            baseUrlStart: track.baseUrl?.slice(0, 220) ?? ""
          })),
          extensionRuntimeVisibleInPage: Boolean(globalThis.chrome?.runtime?.id)
        }
      })()`
    )

    const timedtextProbe = await evaluate(
      page,
      `(async () => {
        const tracks =
          window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
        const track = tracks[0]
        if (!track?.baseUrl) {
          return []
        }

        const urls = new Set()
        const addFmt = (urlText, fmt) => {
          const url = new URL(urlText)
          if (fmt) {
            url.searchParams.set("fmt", fmt)
          } else {
            url.searchParams.delete("fmt")
          }
          urls.add(url.toString())
        }

        addFmt(track.baseUrl, null)
        for (const fmt of ["json3", "srv3", "vtt"]) {
          addFmt(track.baseUrl, fmt)
        }

        const base = new URL(track.baseUrl)
        const videoId = base.searchParams.get("v")
        const languageCode = track.languageCode || base.searchParams.get("lang") || ""
        const kind = track.kind || base.searchParams.get("kind") || "asr"
        if (videoId && languageCode) {
          for (const fmt of ["json3", "srv3", "vtt", null]) {
            const minimal = new URL("https://www.youtube.com/api/timedtext")
            minimal.searchParams.set("v", videoId)
            minimal.searchParams.set("lang", languageCode)
            if (kind) {
              minimal.searchParams.set("kind", kind)
            }
            if (fmt) {
              minimal.searchParams.set("fmt", fmt)
            }
            urls.add(minimal.toString())
          }
        }

        const results = []
        for (const url of urls) {
          const started = performance.now()
          try {
            const response = await fetch(url, {
              credentials: "include",
              cache: "no-store"
            })
            const text = await response.text()
            results.push({
              urlStart: url.slice(0, 320),
              status: response.status,
              ok: response.ok,
              length: text.length,
              textStart: text.slice(0, 700),
              ms: Math.round(performance.now() - started)
            })
          } catch (error) {
            results.push({
              urlStart: url.slice(0, 320),
              error: error instanceof Error ? error.message : String(error),
              ms: Math.round(performance.now() - started)
            })
          }
        }

        return results
      })()`
    )

    const transcriptApiProbe = await evaluate(
      page,
      `(async () => {
        const stringify = (value) => {
          try {
            return JSON.stringify(value)
          } catch {
            return ""
          }
        }
        const initialDataJson = stringify(window.ytInitialData)
        const playerResponseJson = stringify(window.ytInitialPlayerResponse)
        const html = document.documentElement?.innerHTML ?? ""
        const combined = [initialDataJson, playerResponseJson, html].join("\\n")
        const params = []
        const patterns = [
          /"getTranscriptEndpoint":\\{"params":"([^"]+)"/g,
          /"getTranscriptEndpoint"\\s*:\\s*\\{\\s*"params"\\s*:\\s*"([^"]+)"/g
        ]
        for (const pattern of patterns) {
          let match
          while ((match = pattern.exec(combined)) !== null) {
            const raw = match[1]
            if (raw && !params.includes(raw)) {
              params.push(raw)
            }
          }
        }

        const ytcfgGet = (key) => window.ytcfg?.get?.(key)
        const apiKey = ytcfgGet("INNERTUBE_API_KEY")
        const context =
          ytcfgGet("INNERTUBE_CONTEXT") ?? {
            client: {
              clientName: "WEB",
              clientVersion: ytcfgGet("INNERTUBE_CONTEXT_CLIENT_VERSION")
            }
          }
        const endpoint = apiKey
          ? "https://www.youtube.com/youtubei/v1/get_transcript?key=" +
            encodeURIComponent(apiKey)
          : null

        const countSegments = (payload) => {
          const text = stringify(payload)
          return {
            transcriptSegmentRenderer: (text.match(/transcriptSegmentRenderer/g) ?? []).length,
            transcriptCueRenderer: (text.match(/transcriptCueRenderer/g) ?? []).length,
            textStart: text.slice(0, 900)
          }
        }

        const requests = []
        if (endpoint) {
          for (const param of params.slice(0, 6)) {
            const candidates = new Set([param])
            try {
              candidates.add(decodeURIComponent(param))
            } catch {}
            for (const candidate of candidates) {
              const started = performance.now()
              try {
                const response = await fetch(endpoint, {
                  method: "POST",
                  credentials: "include",
                  cache: "no-store",
                  headers: {
                    "content-type": "application/json",
                    "x-youtube-client-name": String(
                      context?.client?.clientName ?? ytcfgGet("INNERTUBE_CONTEXT_CLIENT_NAME") ?? "WEB"
                    ),
                    "x-youtube-client-version": String(
                      context?.client?.clientVersion ??
                        ytcfgGet("INNERTUBE_CONTEXT_CLIENT_VERSION") ??
                        "2.20260421.00.00"
                    )
                  },
                  body: JSON.stringify({ context, params: candidate })
                })
                const payload = await response.json().catch(async () => ({
                  rawText: await response.text()
                }))
                requests.push({
                  status: response.status,
                  ok: response.ok,
                  paramStart: candidate.slice(0, 160),
                  ms: Math.round(performance.now() - started),
                  segmentCounts: countSegments(payload)
                })
              } catch (error) {
                requests.push({
                  error: error instanceof Error ? error.message : String(error),
                  paramStart: candidate.slice(0, 160),
                  ms: Math.round(performance.now() - started)
                })
              }
            }
          }
        }

        return {
          initialDataLength: initialDataJson.length,
          playerResponseLength: playerResponseJson.length,
          htmlLength: html.length,
          firstGetTranscriptIndex: combined.indexOf("getTranscriptEndpoint"),
          paramCount: params.length,
          paramsStart: params.slice(0, 6).map((param) => param.slice(0, 200)),
          apiKeyExists: Boolean(apiKey),
          requests
        }
      })()`
    )

    const screenshot = await page.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false
    })
    const screenshotPath = path.resolve(outputDir, "youtube-extension.png")
    writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"))

    const targetsAfter = await browser.send("Target.getTargets")
    const report = {
      state,
      nativeTranscriptUiProbe,
      playerCaptionProbe,
      timedtextProbe,
      transcriptApiProbe,
      toggleProbe,
      extensionTargets: targetsAfter.targetInfos
        .filter((target) => target.url?.startsWith("chrome-extension://"))
        .map((target) => ({
          type: target.type,
          title: target.title,
          url: target.url
        })),
      consoleEvents: consoleEvents.slice(-80),
      exceptions,
      timedtextRequests: Array.from(requestUrls.values())
        .filter(
          (request) =>
            request.url.includes("/api/timedtext") ||
            request.url.includes("get_transcript")
        )
        .map((request) => ({
          url: request.url,
          method: request.method,
          postDataStart: request.postData.slice(0, 1200)
        }))
        .slice(-80),
      networkFailures: networkFailures.slice(-80),
      targetsBefore: targetsBefore.targetInfos.length,
      targetsAfter: targetsAfter.targetInfos.length,
      screenshotPath,
      chromeStderrTail: stderr.slice(-3000)
    }

    const reportPath = path.resolve(outputDir, "youtube-extension-report.json")
    writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ reportPath, screenshotPath, state }, null, 2))

    page.close()
    browser.close()
  } finally {
    if (process.env.KEEP_BROWSER !== "1") {
      chrome.kill()
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
