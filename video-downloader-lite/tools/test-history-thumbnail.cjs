// Run: node video-downloader-lite/tools/test-history-thumbnail.cjs [path-to-typescript]
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require(process.argv[2] || 'typescript')
const source = fs.readFileSync(path.join(__dirname, '..', 'index.tsx'), 'utf8')
const tree = ts.createSourceFile('index.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
assert.equal(tree.parseDiagnostics.length, 0)
const component = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'VideoThumb')
assert(component)
const code = ts.transpileModule(component.getText(tree), {
  compilerOptions: { jsx: ts.JsxEmit.React },
}).outputText
let memo, reads = [], logs = [], mode = 'ok'
const image = { width: 216, height: 138 }
const context = {
  React: { createElement: (type, props) => ({ type, props }) },
  Image: 'Image', RoundedRectangle: 'RoundedRectangle',
  UIImage: { fromFile: file => {
    reads.push(file)
    if (mode === 'throw') throw new Error('unreadable')
    return mode === 'missing' ? null : image
  } },
  appendDebug: line => logs.push(line),
  useMemo: (fn, deps) => {
    if (!memo || !Object.is(memo.path, deps[0])) memo = { path: deps[0], image: fn() }
    return memo.image
  },
}
vm.runInNewContext(code, context)
const render = path => context.VideoThumb({ path })
assert.equal(render(undefined).type, 'RoundedRectangle')
assert.equal(reads.length, 0)
// First render must already carry decoded image; no effect, timer or download needed.
let result = render('/history/old.thumb.jpg')
assert.equal(result.type, 'Image')
assert.equal(result.props.image, image)
assert.equal(result.props.filePath, undefined)
assert.equal(result.props.clipShape.cornerRadius, 6)
render('/history/old.thumb.jpg')
assert.equal(reads.length, 1)
render('/history/new.thumb.jpg')
assert.equal(reads.length, 2)
mode = 'missing'
assert.equal(render('/history/missing.jpg').type, 'RoundedRectangle')
mode = 'throw'
assert.equal(render('/history/unreadable.jpg').type, 'RoundedRectangle')
assert.equal(logs.length, 2)
assert(!source.includes('imgTick'))
assert(!source.includes('setImgTick'))
assert(source.indexOf('initialHistory = await listHistory(50)') < source.indexOf('await Navigation.present'))
console.log('PASS: first-render image, same-path reuse, changed path, missing/corrupt fallback and startup preload')
