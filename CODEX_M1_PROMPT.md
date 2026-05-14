# Codex Prompt: Implement M1

## 你的角色

你是本项目的实现者。你要实现一个 Chrome MV3 浏览器扩展，帮助用户在 YouTube 上学习英语。

先按顺序完整阅读：

1. `PRODUCT_SPEC.md`
2. `ARCHITECTURE.md`
3. `MILESTONES.md`
4. 本文件

`ARCHITECTURE.md` 是项目宪法。遇到架构不确定，先停下来问用户，不要自己改设计。

## 本轮范围

只实现 M1：Transcript Panel + Save + Export。

必须实现：

- Plasmo + React + TypeScript 项目。
- YouTube watch 页面注入 content script。
- 提取当前视频英文字幕轨。
- 拉取完整 transcript。
- 右侧字幕面板。
- 当前字幕高亮。
- 点击字幕跳转时间。
- 单词右键保存。
- 保存当前句和前后各 2 段上下文。
- Dexie / IndexedDB 存储。
- 生词本 tab 页面。
- CSV / JSON 导出。

不得实现：

- 不做悬停中文释义。
- 不做详细解释。
- 不做 OpenAI/API key。
- 不做 Anki。
- 不做 SRS。
- 不做 LR 兼容。
- 不读取 Language Reactor DOM。
- 不依赖选中文字保存。

## 技术约束

- TypeScript strict。
- 使用 Plasmo。
- 使用 React。
- 使用 Dexie。
- 不使用 `youtube-transcript-plus`。
- transcript 解析用本项目自己的 `json3/xml` parser。
- storage 由 extension origin 管理，不在 YouTube origin 直接写学习数据。
- 保存动作不能依赖网络翻译。

## 建议目录

按 `ARCHITECTURE.md` 的目录建。M1 至少需要：

```text
src/
  background.ts
  contents/
    youtube.tsx
  tabs/
    vocab.tsx
  components/
    CaptionPanel.tsx
    CaptionRow.tsx
    WordToken.tsx
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
  types.ts
```

## 实现步骤

### Step 1: 初始化

在当前目录初始化 Plasmo 项目，不要新建子目录。

```powershell
pnpm create plasmo . --with-src --with-tailwindcss
pnpm add dexie uuid
pnpm add -D @types/uuid
```

如当前目录已有文档，保留文档。

**已知坑**：`pnpm create plasmo .` 对非空目录会报错退出（上一项目踩过）。如果遇到，走以下等效流程：

```powershell
pnpm create plasmo _tmp --with-src --with-tailwindcss
# _tmp 里的所有文件（包括点文件）移动到当前目录，冲突时保留当前目录里的 .md 文档
Move-Item -Path _tmp\* -Destination . -Force
Move-Item -Path _tmp\.* -Destination . -Force -ErrorAction SilentlyContinue
Remove-Item _tmp -Recurse -Force
pnpm add dexie uuid
pnpm add -D @types/uuid
```

初始化完成后确认：`package.json`、`tsconfig.json`、`src/` 都存在，且 `README.md` / `ARCHITECTURE.md` / `PRODUCT_SPEC.md` / `MILESTONES.md` / `CODEX_M1_PROMPT.md` 没有被覆盖。

### Step 2: 类型和消息协议

实现：

- `src/types.ts`
- `src/lib/messages.ts`

类型严格遵守 `ARCHITECTURE.md` 第 5、6 节。

### Step 3: transcript 获取

实现：

- `src/lib/transcript/youtubeTrack.ts`
- `src/lib/transcript/parseJson3.ts`
- `src/lib/transcript/parseXml.ts`
- `src/lib/transcript/tokenize.ts`
- `src/lib/transcript/context.ts`

要求：

- 从 page player response 提取 captionTracks。
- 选择英文 track。
- 优先请求 `fmt=json3`。
- json3 失败回退 XML。
- 输出统一 `TranscriptSegment[]`。
- tokenization 至少支持英文单词、撇号、连字符。

### Step 4: content script UI

实现 `src/contents/youtube.tsx` 和组件：

- 注入右侧 fixed panel。
- YouTube SPA 导航变化时重新加载 transcript。
- 监听 video `timeupdate`。
- 高亮当前 segment。
- 点击 segment 设置 `video.currentTime = segment.start`。
- 每个 word token 绑定 `contextmenu`。
- `contextmenu` 中 `preventDefault()`，然后发送 `SAVE_WORD`。

### Step 5: background 保存

实现：

- 接收 `SAVE_WORD`。
- 组装 `VocabEntry`。
- 写 Dexie。
- 返回成功/失败。

保存上下文：

- 当前 segment 前后各 2 段。
- 边界不足时按实际可用段数。

### Step 6: 生词本页面

实现 `src/tabs/vocab.tsx`：

- 倒序显示所有记录。
- 显示 word、sentence、contextText、videoTitle、createdAt。
- 视频链接可点击。
- CSV / JSON 导出按钮。

### Step 7: 验收

运行：

```powershell
pnpm build
```

手动验收：

1. Chrome 加载 `build/chrome-mv3-dev` 或 prod build。
2. 打开以下任一测试视频（按顺序试，直到遇到一个有英文字幕的）：
   - `https://www.youtube.com/watch?v=7xTGNNLPyMI`（Karpathy Deep Dive into LLMs，人工英文字幕，长视频）
   - `https://www.youtube.com/watch?v=zjkBMFhNj_g`（Karpathy Intro to LLMs，备选）
   - `https://www.youtube.com/watch?v=kCc8FmEb1nY`（Karpathy Let's build GPT，备选）
3. 看到右侧字幕面板。
4. 播放时当前字幕高亮。
5. 右键一个单词保存，UI 有保存成功 toast。
6. 打开生词本，确认记录存在、包含 word/sentence/contextText/videoTitle/videoUrl(带 t=)/createdAt 全部字段。
7. 刷新页面，记录仍存在。
8. 导出 CSV / JSON，文件字段不串列。
9. 在视频页 URL 栏直接改到另一个 watch 视频（模拟 SPA 导航），不刷新页面，确认面板换成新视频的字幕、无重复 DOM、无 console error。

## 提交要求

如果目录已是 git repo，每完成一个稳定子阶段 commit 一次：

- `M1.1 scaffold extension`
- `M1.2 load and render transcript`
- `M1.3 save word with context`
- `M1.4 vocab page and export`
- `M1.5 verification fixes`

最后写 `M1_REPORT.md`，包含：

- 实现文件列表。
- 验收项结果。
- 已知问题。
- M2 建议。

## 遇到问题时

不要直接扩大 scope。

如果是 YouTube player response 取不到：

- 先做最小 probe，确认页面上实际变量和 caption track 结构。
- 把 probe 结果写入 `test/`。
- 记住 content script 跑在 isolated world，不能直接读 `window.ytInitialPlayerResponse`。按 `ARCHITECTURE.md §3.1` 的两种方式之一处理。
- 再改实现。

如果是字幕 track 没有英文：

- UI 显示"该视频没有可用英文字幕"。
- 不要 fallback 到 LR。
- 不要 fallback 到非英文语种。

如果是 service worker fetch/CORS 问题：

- 先确认 transcript 的 fetch 是不是被错误地放进了 background。transcript fetch 必须在 content script 里。
- 不要引入 Node 风格 transcript 包。
- 不要为了"绕开 CORS"加 `host_permissions` 之外的域名。

如果切视频后面板消失或字幕没更新：

- 不是 bug 定位优先项，先检查是否监听了 `yt-navigate-finish`。
- 检查旧 panel 有没有被卸载，新 panel 有没有重新挂。
- 检查 `video` 元素引用是不是旧的（YouTube 换视频可能换 video 节点）。

如果 word token 右键菜单触发异常（弹出 YouTube 原生菜单 / 不触发保存）：

- 在 token 的 `contextmenu` handler 里 `event.preventDefault()` + `event.stopPropagation()`。
- panel 容器层也加一个 `contextmenu` 阻止器。
- 不要改成点击保存，右键保存是产品决策。

如果 DevTools 显示 `chrome.runtime.lastError: The message port closed before a response was received`：

- background 的 listener 没 `return true`，或者 async handler 没正确调用 `sendResponse`。
- 按 `ARCHITECTURE.md §6` 的 listener 规则改。

如果怀疑架构不合理：

- 停下来问用户，不要自己改 `ARCHITECTURE.md` 后继续实现。
- 架构改动必须先改文档再改代码。
