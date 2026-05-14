# M1 Report

## 1. 实现文件列表

### 基础与配置
- package.json

### 核心类型与协议
- src/types.ts
- src/lib/messages.ts

### 存储与后台
- src/lib/storage.ts
- src/background.ts

### transcript 模块
- src/lib/transcript/types.ts
- src/lib/transcript/youtubeTrack.ts
- src/lib/transcript/parseJson3.ts
- src/lib/transcript/parseXml.ts
- src/lib/transcript/tokenize.ts
- src/lib/transcript/context.ts

### 导出模块
- src/lib/export/csv.ts
- src/lib/export/json.ts

### UI 组件
- src/components/CaptionPanel.tsx
- src/components/CaptionRow.tsx
- src/components/WordToken.tsx
- src/components/Toast.tsx

### 内容脚本（YouTube）
- src/contents/playerResponse.ts
- src/contents/mount.ts
- src/contents/youtube.tsx

### 扩展页面
- src/tabs/vocab.tsx
- src/popup.tsx

### 移除模板残留
- 删除 src/content.tsx
- 删除 src/features/count-button.tsx

## 2. 验收项结果

### 已完成（代码实现 + 本地构建验证）
- [x] Plasmo + React + TypeScript 项目初始化（采用官方 examples 等效初始化）
- [x] M1 所需目录与模块落地
- [x] YouTube 页面内容脚本入口与 SPA 导航监听（yt-navigate-finish + MutationObserver）
- [x] 从 ytInitialPlayerResponse 读取 captionTracks（脚本文本优先 + page world 兜底）
- [x] 英文 track 选择策略按优先级实现
- [x] transcript 拉取：json3 优先，失败回退 XML
- [x] 右侧字幕面板渲染、滚动、当前 segment 高亮
- [x] 点击 segment 跳转视频时间
- [x] 字幕单词 token 化并支持右键保存
- [x] 保存时携带 sentence + 前后各 2 段上下文
- [x] Background + Dexie 持久化 vocab
- [x] 生词本页面（tabs/vocab）展示与刷新
- [x] CSV / JSON 导出
- [x] `pnpm exec tsc --noEmit` 通过
- [x] `pnpm build` 通过，产物可生成

### 待你手动验收（需要真实浏览器环境）
- [ ] 在目标 YouTube 视频上确认完整字幕加载与播放高亮
- [ ] 右键指定单词（如 example）后在生词本确认完整字段
- [ ] 刷新页后记录仍在
- [ ] CSV 用 Excel 打开字段不串列
- [ ] 直接改 watch URL 模拟 SPA 切换后，面板正确切换且无重复 listener/DOM

## 3. 已知问题

1. transcript 缓存写入（transcripts 表）在 M1 中未启用，只实现了读取接口占位，当前策略为每次页面加载重新拉取字幕。
2. 未在本地执行自动化浏览器 E2E；YouTube 真实页面行为需要你在 Chrome 扩展环境做最终确认。
3. 由于模板初始化工具在当前终端是交互阻塞，采用了官方 Plasmo examples 的等效脚手架方式（最终仍是 Plasmo 项目）。

## 4. M2 建议

1. 增加 TranslationProvider 抽象落地（NullProvider + OpenAIProvider），保证无 API key 时 M1 主链路不退化。
2. 增加 translationCache（normalizedWord + sentence hash）命中策略，避免重复请求。
3. 在 word token 上增加 hover 触发与 1-2 秒内响应控制（防抖 + 取消过期请求）。
4. 将 transcript 缓存写入 background（按 videoId + trackUrl），减少重复拉取。
5. 增加一个轻量设置页，仅用于 API key 配置与 provider 切换，不改 M1 交互路径。
