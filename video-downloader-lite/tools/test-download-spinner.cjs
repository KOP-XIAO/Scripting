// Run: node video-downloader-lite/tools/test-download-spinner.cjs [path-to-typescript]
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require(process.argv[2] || 'typescript')
const src = fs.readFileSync(path.join(__dirname, '..', 'index.tsx'), 'utf8')
const tree = ts.createSourceFile('index.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
assert.equal(tree.parseDiagnostics.length, 0)
const fn = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'DownloadSpinner')
assert(fn)
let angle = 0, now = 0, callback, cleanup, active = false, mounted = false
const ctx = {
  Circle: 'Circle', Date: { now: () => now },
  React: { createElement: (type, props, ...children) => ({ type, props, children }) },
  useState: () => [angle, v => { angle = v }],
  useEffect: fn => { if (!mounted) { mounted = true; cleanup = fn() } },
  setInterval: (fn, ms) => { assert.equal(ms, 33); callback = fn; active = true; return 1 },
  clearInterval: id => { assert.equal(id, 1); active = false },
}
vm.runInNewContext(ts.transpileModule(fn.getText(tree), { compilerOptions: { jsx: ts.JsxEmit.React } }).outputText, ctx)
const initial = ctx.DownloadSpinner()
assert.equal(initial.props.stroke.strokeStyle.lineWidth, 4)
assert.equal(initial.props.stroke.shapeStyle, '#0D1117')
assert.equal(initial.props.frame.width, 28)
now = 900; callback()
assert.equal(ctx.DownloadSpinner().props.rotationEffect - initial.props.rotationEffect, 360)
cleanup(); assert.equal(active, false)
// The rotating arc must remain outside the disabled Button's view hierarchy.
let inset
const walk = n => { if (ts.isJsxAttribute(n) && n.name.getText(tree) === 'safeAreaInset') inset = n; ts.forEachChild(n, walk) }
walk(tree)
const buttons = [], spinners = []
const visit = n => { if (ts.isJsxElement(n) && n.openingElement.tagName.getText(tree) === 'Button') buttons.push(n); if (ts.isJsxSelfClosingElement(n) && n.tagName.getText(tree) === 'DownloadSpinner') spinners.push(n); ts.forEachChild(n, visit) }
visit(inset)
assert.equal(buttons.length, 1); assert.equal(spinners.length, 1)
assert(!(spinners[0].pos > buttons[0].pos && spinners[0].end < buttons[0].end))
assert(buttons[0].getText(tree).includes('disabled={loading}'))
assert(inset.getText(tree).includes('fill={loading ? getTheme().accent : getTheme().bgTop}'))
console.log('PASS: bold full-contrast arc, continuous rotation, timer cleanup and disabled-state isolation')
