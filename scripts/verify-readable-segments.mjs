import { readFileSync } from "node:fs"
import assert from "node:assert/strict"
import vm from "node:vm"

import ts from "typescript"

const loadReadableSegmentsModule = () => {
  const source = readFileSync(
    new URL("../src/lib/transcript/readableSegments.ts", import.meta.url),
    "utf8"
  )
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  }).outputText

  const module = { exports: {} }
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    console
  })
  return module.exports
}

const { createReadableCaptionSegments } = loadReadableSegmentsModule()

const fragmentedSegments = [
  {
    start: 0,
    end: 0.8,
    text: "to text and what this actually looks"
  },
  {
    start: 0.82,
    end: 1.8,
    text: "like so one website I like to use to"
  },
  {
    start: 1.81,
    end: 2.6,
    text: "explore these token representations is"
  },
  {
    start: 2.61,
    end: 3.2,
    text: "raw"
  },
  {
    start: 3.21,
    end: 4.1,
    text: "text into these symbols"
  }
]

const readable = createReadableCaptionSegments(fragmentedSegments, true)

assert.equal(
  readable[0]?.text,
  "to text and what this actually looks",
  "medium non-overlapping cue should not be swallowed into the next line"
)

assert.equal(
  readable[1]?.text,
  "like so one website I like to use to explore these token representations is",
  "short lead fragment can still merge into the following cue"
)

assert.equal(
  readable[2]?.text,
  "raw text into these symbols",
  "single-word lead fragment should merge instead of becoming a lonely row"
)

const overlapSegments = [
  { start: 0, end: 1.1, text: "hello world" },
  { start: 1.12, end: 2.1, text: "world turns out to be" },
  { start: 2.11, end: 3.1, text: "to be exactly two tokens" },
  { start: 3.11, end: 4.2, text: "exactly two tokens total" }
]

const overlapReadable = createReadableCaptionSegments(overlapSegments, true)

assert.equal(overlapReadable.length, 1, "overlap-based rolling captions should still merge")
assert.equal(
  overlapReadable[0]?.text,
  "hello world turns out to be exactly two tokens total"
)

console.log("readableSegments verification passed")
