# Milestones

当前状态：`M1 已完成`，`M2 已有可用基础版（内置词典 + 缓存 + 在线兜底 + 设置页）`。

## M1: Transcript Panel + Save + Export

目标：先做出不依赖 LR 的可用闭环。

交付：

- Chrome MV3 / Plasmo 项目初始化。
- YouTube watch 页面 content script 注入。
- 从当前视频提取英文 caption track。
- 拉取并解析完整 transcript。
- 右侧字幕面板展示完整字幕。
- 当前播放 segment 自动高亮。
- 点击字幕 segment 跳转播放时间。
- 每个英文单词是可交互 token。
- 右键 token 立即保存。
- 保存记录包含当前句和前后各 2 段上下文。
- IndexedDB 持久化。
- 生词本 tab 页面展示保存记录。
- CSV / JSON 导出。

验收：

- 打开 `https://www.youtube.com/watch?v=7xTGNNLPyMI` 后，扩展面板能显示完整英文字幕。
- 播放视频时，当前字幕自动高亮。
- 在字幕面板中右键 `example`，生词本出现一条记录。
- 该记录包含 `example`、当前字幕句、前后上下文、视频标题、带 `t=` 的链接。
- 刷新页面后记录仍存在。
- 导出 CSV 后，Excel 可以正常打开，字段不串列。
- 关掉 Language Reactor 后仍可用。
- 开着 Language Reactor 时也可用，因为不依赖 LR。

## M2: Hover Brief Meaning

目标：鼠标悬停单词显示简明中文释义。

交付：

- TranslationProvider 接口。
- OpenAI-compatible provider。
- API key 设置页。
- translationCache。
- hover tooltip。

验收：

- 没有 API key 时，M1 功能完全正常。
- 有 API key 时，悬停单词 1-2 秒内显示中文简释。
- 同一单词同一句再次悬停走缓存。
- 翻译失败只显示轻提示，不影响保存。

## M3: Detailed Word Panel

目标：点击单词查看更深解释。

交付：

- 单词详情浮层。
- 上下文含义。
- 词性。
- 常见释义。
- 整句自然中文翻译。
- 保存 detailedMeaning 到词条。

验收：

- 点击已保存或未保存单词均可打开详情。
- 已保存词条详情能回写到生词本。

## M4: Review Workflow

目标：让保存的数据更适合复习。

交付：

- 按视频分组。
- 按保存时间筛选。
- 标记已掌握/未掌握。
- 简单复习视图。

验收：

- 用户可以只复习某个视频保存的词。
- 用户可以隐藏已掌握词。

## M5: Packaging

目标：打包为稳定本地使用版本。

交付：

- README 安装说明。
- 构建脚本。
- 基础 QA 清单。
- 可加载的 `build/chrome-mv3-prod`。

验收：

- 新 Chrome profile 中加载扩展成功。
- 无 service worker 报错。
- YouTube 视频页无 console error spam。
- 连续切换 5 个不同视频后，panel 仍正常挂载，不累积重复 DOM、不累积重复 `timeupdate` listener。
- 关闭再打开面板 3 次，无残留节点、无 React "Cannot update unmounted component" 警告。
- 在 DevTools Memory 面板做 3 次 heap snapshot（初始 / 看完一个视频 / 切到第二个视频），无明显增长的 TranscriptSegment / WordToken 留存。
