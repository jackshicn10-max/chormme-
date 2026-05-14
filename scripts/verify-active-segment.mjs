import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import assert from "node:assert/strict"
import ts from "typescript"

const source = fs.readFileSync(
  path.resolve("src/lib/transcript/activeSegment.ts"),
  "utf8"
)

const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
}).outputText

const module = { exports: {} }
vm.runInNewContext(
  transpiled,
  {
    module,
    exports: module.exports,
    require: () => ({})
  },
  { filename: "activeSegment.ts" }
)

const { findActiveSegmentIndex } = module.exports

const segments = [
  { id: "a", start: 10, end: 15, text: "A plus B", tokens: [] },
  { id: "b", start: 12, end: 13, text: "short middle sentence", tokens: [] },
  { id: "c", start: 16, end: 18, text: "next sentence", tokens: [] }
]

assert.equal(findActiveSegmentIndex(segments, 9.9), -1)
assert.equal(findActiveSegmentIndex(segments, 10.1), 0)
assert.equal(findActiveSegmentIndex(segments, 12.1), 1)
assert.equal(findActiveSegmentIndex(segments, 13.8), 1)
assert.equal(findActiveSegmentIndex(segments, 14.3), -1)
assert.equal(findActiveSegmentIndex(segments, 16.1), 2)
assert.equal(findActiveSegmentIndex(segments, 20), -1)

console.log("activeSegment verification passed")
