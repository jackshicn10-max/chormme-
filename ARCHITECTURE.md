# Architecture

本文件是项目宪法。后续实现如果与本文冲突，先停下来更新设计，不要直接改代码绕过去。

## 1. 总体架构

这是一个 Chrome MV3 浏览器扩展。它在 YouTube watch 页面注入自己的字幕学习面板，不依赖 Language Reactor，不依赖用户选中 YouTube 原生字幕。

```text
YouTube page
  |
  | content script (YouTube origin, isolated world)
  | - 读取视频 DOM/currentTime
  | - 从页面 <script> 文本提取 ytInitialPlayerResponse
  | - 选 caption track 并 fetch transcript (走 YouTube origin, 带 cookie)
  | - 解析 json3/xml
  | - 注入 React 字幕面板
  | - 处理单词右键/悬停
  |
  | chrome.runtime.sendMessage (typed)
  v
background service worker (extension origin)
  | - 缓存 transcript (可选, videoId 命中跳过 fetch)
  | - 保存 vocab entry
  | - 导出文件
  | - 后续调用 translation provider
  |
  v
IndexedDB (extension origin)
```

transcript 的 HTTP fetch 必须在 content script 里执行，不得放进 background service worker：
- auto-generated caption 的 `baseUrl` 会带 signature，且对 cookie 敏感。
- SW 的 fetch 走 extension origin，不发 YouTube cookie，实测会把 auto-captions 变成空响应。
- content script fetch 走 YouTube origin，复用页面会话，最稳定。

## 2. 关键原则

- 字幕 UI 必须由本扩展自己渲染。
- 保存动作必须发生在本扩展渲染的 word token 上。
- 不抓 Language Reactor DOM。
- 不依赖 `window.getSelection()`。
- transcript 拉取和解析必须是独立模块，不能散落在 UI 代码里。
- storage 归 background/extension origin 管理，content script 不直接写 YouTube origin 的 IndexedDB。
- M1 保存必须离线可用，不依赖 LLM/API key。

## 3. 字幕数据来源

优先使用 YouTube 页面已有的 player response。

### 3.1 读取 ytInitialPlayerResponse

MV3 content script 跑在 isolated world，**不能直接读** `window.ytInitialPlayerResponse`。采用以下方式之一，按优先级：

1. **文本正则（推荐）**：扫描 `document.documentElement.innerHTML` 或 `<script>` 节点文本，匹配 `ytInitialPlayerResponse\s*=\s*({.+?});` 并 `JSON.parse`。无需 page-world 注入，不触碰 page 变量。
2. **page-world 注入兜底**：如果正则拿不到（SPA 切页后 DOM 里已经不带 initial payload），注入 `<script>` 到 page world 读 `window.ytInitialPlayerResponse`，通过 `window.postMessage` 回传给 content script，content script 用 `origin + data.source` 做白名单校验。

### 3.2 选择英文 track

从 `captions.playerCaptionsTracklistRenderer.captionTracks` 按以下优先级选一条：

1. `languageCode === "en"` 且非 `kind: "asr"`（人工英文字幕）。
2. `languageCode === "en"` 且 `kind === "asr"`（英文自动字幕）。
3. `languageCode.startsWith("en")` 且非 `kind: "asr"`（如 `en-US`、`en-GB` 的人工字幕）。
4. `languageCode.startsWith("en")`（任何 `en-*` 自动字幕）。
5. 都没有，UI 显示"该视频没有可用英文字幕"，不要 fallback 其他语言。

### 3.3 拉取 transcript

- 在 content script 里 `fetch(baseUrl + "&fmt=json3")`。
- json3 失败（HTTP 非 2xx、空 body、JSON 解析失败）回退不带 `fmt` 的 XML。
- 两个 parser 输出统一的 `TranscriptSegment[]`（仅 `{ start, end, text }`，tokens 另算，见 §5.1）。
- fetch 成功后通过 `chrome.runtime.sendMessage` 把解析结果发给 background 缓存（可选优化，M1 可先跳过，每次重新拉）。

### 3.4 禁用项

不要在 M1 引入 `youtube-transcript-plus`。旧项目已验证打包进 MV3 service worker 会引入 Node polyfill 风险，且该库内部也是 fetch，没有额外好处。

## 4. 模块划分

建议目录：

```text
src/
  background.ts
  contents/
    youtube.tsx         # content script 入口, SPA 导航监听, panel mount 调度
    mount.ts            # panel DOM mount/unmount, React root 生命周期
    playerResponse.ts   # ytInitialPlayerResponse 读取 (正则 / page-world 注入)
  tabs/
    vocab.tsx
  components/
    CaptionPanel.tsx
    CaptionRow.tsx
    WordToken.tsx
    Toast.tsx
  lib/
    messages.ts
    storage.ts
    transcript/
      types.ts
      youtubeTrack.ts
      parseJson3.ts
      parseXml.ts
      tokenize.ts
      context.ts
    export/
      csv.ts
      json.ts
    translation/
      types.ts
      nullProvider.ts
      openaiProvider.ts
  types.ts
```

`contents/mount.ts` 必须处理：
- 首次进入 watch 页挂载面板。
- `yt-navigate-finish` 事件后清理旧 panel / 旧 React root / 旧 timeupdate listener，再重新挂载。
- 面板容器被 YouTube 重建（`MutationObserver` 发现 `#secondary` 消失）时重挂。

## 5. 数据模型

### 5.1 运行时 vs 持久化

`tokens` 是 UI 派生数据，不写 IndexedDB。持久化用 `CachedTranscriptSegment`，运行时 UI 用 `TranscriptSegment`（= cached + tokens）。

```ts
// 持久化（transcripts 表）
export type CachedTranscriptSegment = {
  start: number
  end: number
  text: string
}

// 运行时（UI 层，现算 tokens）
export type TranscriptSegment = CachedTranscriptSegment & {
  id: string
  tokens: WordToken[]
}

export type WordToken = {
  id: string
  surface: string
  normalized: string
  indexInSegment: number
}

export type VideoMeta = {
  platform: "youtube"
  videoId: string
  title: string
  url: string
  channelName?: string
}

export type VocabEntry = {
  id: string
  word: string
  normalizedWord: string
  sentence: string
  contextText: string
  contextBefore: string[]
  contextAfter: string[]
  videoId: string
  videoTitle: string
  videoUrl: string
  timestamp: number
  segmentId: string
  briefMeaning: string | null
  detailedMeaning: string | null
  note: string
  createdAt: string
  updatedAt: string
}
```

Dexie schema v1：

```ts
vocab: "id, normalizedWord, videoId, createdAt, timestamp"
transcripts: "videoId, fetchedAt"
translationCache: "key, normalizedWord, createdAt"
```

## 6. 消息协议

content script 与 background 之间只用 typed messages。

```ts
type Message =
  | { type: "GET_TRANSCRIPT"; payload: { videoId: string; trackUrl: string } }
  | { type: "SAVE_WORD"; payload: SaveWordPayload }
  | { type: "GET_RECENT_VOCAB"; payload: { limit: number } }
  | { type: "EXPORT_VOCAB"; payload: { format: "csv" | "json" } }

type MessageResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string }
```

`SaveWordPayload`：

```ts
type SaveWordPayload = {
  word: string
  normalizedWord: string
  segmentId: string
  timestamp: number
  videoMeta: VideoMeta
  transcriptWindow: {
    sentence: string
    before: string[]
    after: string[]
  }
}
```

Background listener 规则：

- 所有 handler 统一返回 `MessageResponse`，失败时 `error` 必须是可读英文短句。
- handler 是 async 的（写 Dexie），listener 函数必须 **`return true`** 以保持 `sendResponse` channel 开放。不要用顶层 `async` listener，Chrome 会立即 resolve `undefined`。
- content script 侧 `chrome.runtime.sendMessage` 用 Promise 形式等待，自己处理 `chrome.runtime.lastError`。

## 7. 保存上下文策略

M1 固定保存当前 segment 前后各 2 段：

```text
contextBefore = segments[idx - 2], segments[idx - 1]
sentence      = segments[idx]
contextAfter  = segments[idx + 1], segments[idx + 2]
contextText   = before + sentence + after joined by space
```

边界处理：

- `idx - 2 < 0` 或 `idx + 2 >= segments.length` 时，`before` / `after` 按实际可用段数截断，不填空串。
- `contextText` 永远是"实际拼出来的非空段" join 的结果，不要插入空行。
- 即使 `before` 和 `after` 都为空（整段视频只有一段字幕），保存仍应成功，`sentence` 本身保底可用。

原因：

- YouTube 自动字幕通常没有可靠标点。
- 按标点断句不稳定。
- 用户复习时需要比当前字幕行略多的上下文。
- 2 段这个数字在 M1 是固定值，可配置放到 M4。

## 8. 字幕面板 UI

M1 使用 in-page injected panel，而不是 Chrome Side Panel API。

原因：

- 用户要的是类似 LR 的视频页右侧字幕区域。
- content script 直接同步 video currentTime 更简单。
- Word token 的 hover/right-click 交互更直接。

基本行为：

- 默认显示在页面右侧，宽度 420px 左右。
- 可以关闭/打开。
- 当前 segment 高亮。
- 点击 segment 跳转视频时间。
- 右键 word token 立即保存。
- 已保存单词可以在字幕中显示轻微标记。

SPA 导航：

- YouTube 是单页应用，watch → watch、watch → home 之间不会触发 `window.load`。
- 监听 `document.addEventListener("yt-navigate-finish", ...)` 作为主信号；同时用 `MutationObserver` 观察 `location.pathname` 变化或 video element 替换作兜底。
- 每次视频切换：销毁旧 React root、移除旧 panel DOM、解绑旧 video 的 `timeupdate` listener，再以新 videoId 重新走 §3。
- 不做"保留旧 panel + 热更新 transcript"这种省事的方案，因为 YouTube 可能把 `#secondary` 整个换掉，旧 React root 会出 detached node 报错。

contextmenu 拦截：

- word token 的 `contextmenu` 必须 `event.preventDefault()` + `event.stopPropagation()`。
- panel 容器本身也要吃掉 `contextmenu`，防止 YouTube 的自定义菜单盖在我们前面。
- 不要依赖浏览器原生右键菜单，保存就是保存，不弹菜单。

## 9. 翻译架构

M1 不实现翻译，但接口先定义：

```ts
export interface TranslationProvider {
  name: string
  lookupBrief(input: {
    word: string
    sentence: string
    contextText: string
  }): Promise<string>
}
```

M2 实现：

- `NullProvider`：无 API key 时返回空。
- `OpenAIProvider`：用户配置 API key 后启用。
- 本地 `translationCache`：同一个 `normalizedWord + sentenceHash` 不重复请求。

## 10. 导出

M1 支持 CSV 和 JSON。

CSV 字段：

```text
word, normalizedWord, sentence, contextText, videoTitle, videoUrl, timestamp, createdAt, note
```

JSON 直接导出 `VocabEntry[]`。

## 11. 权限

建议最小权限：

```json
{
  "permissions": ["storage", "downloads"],
  "host_permissions": [
    "https://www.youtube.com/*",
    "https://www.youtube-nocookie.com/*"
  ]
}
```

如 M1 中不使用 `chrome.downloads`，可以先用 Blob URL 下载，暂不加 `downloads`。

## 12. 已知风险

- YouTube DOM/player response 结构会变化。
- 有些视频没有英文字幕。
- 自动字幕 text 质量不稳定。
- YouTube 页面是 SPA，切换视频时 content script 必须重新加载 transcript。
- 面板可能遮挡 YouTube 推荐栏，需要提供关闭按钮。

## 13. 不能做的事

- 不读取 LR DOM。
- 不试图修改 LR 行为。
- 不依赖选中文字保存。
- 不把翻译阻塞在保存链路里。
- 不在 M1 做复杂复习系统。
