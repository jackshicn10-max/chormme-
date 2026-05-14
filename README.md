# Tools for Learning English in YouTube

A Chrome/Edge extension for learning English on YouTube. It adds a lightweight Language Reactor-like workflow focused on transcript reading, full-sentence captions, hover translation, and vocabulary capture.

## Features

- Right-side English transcript panel on YouTube watch pages.
- Manual and auto-generated English caption loading.
- Manual caption refresh when YouTube caption tracks get stuck.
- Custom full-sentence player caption overlay to avoid word-by-word auto-caption rendering.
- Caption line highlighting and click-to-seek.
- Hover word translation with bundled dictionary, local cache, and online fallback.
- Manual translation prewarm for upcoming video words.
- Right-click word saving with sentence, context, video title, video ID, URL, and timestamp.
- Video-scoped vocabulary view plus CSV/JSON export.
- Local settings page for LT default state, hover translation, prewarm, prewarm scope/limit, and caption lead seconds.

## Privacy

Vocabulary records, transcript cache, settings, and translation cache are stored locally in the browser through IndexedDB/chrome storage.

The extension includes an optional online translation fallback through `api.mymemory.translated.net` for words that are not found in the bundled dictionary/cache. If you want a fully local-only workflow, disable network access or remove that fallback before packaging.

## Install for Development

Requirements:

- Node.js
- pnpm
- Chrome or Edge with developer mode enabled

Install dependencies:

```powershell
pnpm install
```

Build the extension:

```powershell
pnpm build
```

Load the unpacked extension from:

```text
build/chrome-mv3-prod
```

In Chrome/Edge, open `chrome://extensions` or `edge://extensions`, enable developer mode, choose “Load unpacked”, and select that folder.

## Development

Run Plasmo dev mode:

```powershell
pnpm dev
```

Run type checking:

```powershell
pnpm exec tsc --noEmit
```

Run lightweight verification scripts:

```powershell
node scripts/verify-active-segment.mjs
node scripts/verify-readable-segments.mjs
```

## Usage

1. Open a YouTube video page.
2. Turn on `LT ON` in the player controls.
3. If captions do not load, choose an English caption track in YouTube and click `刷新字幕`.
4. Hover over words in the transcript or overlay to see Chinese definitions.
5. Right-click a word to save it to the vocabulary book.
6. Open the vocabulary book to review or export CSV/JSON.

## Notes

YouTube caption behavior varies by video. Some videos expose manual captions, some expose auto-generated captions, and some tracks require the player to request caption URLs before they can be fetched. The extension tries multiple loading paths, but a manual caption refresh may still be needed on some videos.

## License

MIT
