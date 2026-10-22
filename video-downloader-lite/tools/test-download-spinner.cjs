// Run: node video-downloader-lite/tools/test-download-spinner.cjs [path-to-typescript]
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require(process.argv[2] || 'typescript')
const src = fs.readFileSync(path.join(__dirname, '..', 'index.tsx'), 'utf8')
const tree = ts.createSourceFile('index.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
assert.equal(tree.parseDiagnostics.length, 0)
const fn = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'DownloadProgress')
assert(fn)
const code = ts.transpileModule(fn.getText(tree), { compilerOptions: { jsx: ts.JsxEmit.React } }).outputText
for (const native of [true, false]) {
  const ctx = {
    Circle: 'Circle', ZStack: 'ZStack', Text: 'Text', Image: 'Image',
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    setInterval: () => assert.fail('Progress must not advance on a clock'),
    setTimeout: () => assert.fail('Progress must not advance on a clock'),
  }
  if (native) ctx.Animation = { easeOut: duration => ({ duration }) }
  vm.runInNewContext(code, ctx)
  assert.equal(ctx.DownloadProgress({}).props.systemName, 'hourglass')
  for (const ratio of [0, 0.17, 0.63, 1]) {
    const rendered = ctx.DownloadProgress({ ratio })
    const arc = rendered.children[1], text = rendered.children[2]
    assert.equal(arc.props.trim.to, ratio)
    assert.equal(arc.props.stroke.strokeStyle.lineWidth, 4)
    assert.equal(arc.props.rotationEffect, -90)
    assert.equal(text.children[0], `${Math.round(ratio * 100)}%`)
    if (native) {
      assert.equal(arc.props.animation.value, ratio)
      assert.equal(arc.props.animation.animation.duration, 0.2)
    } else assert.equal(arc.props.animation, undefined)
    // An unchanged transfer must never produce extra progress.
    assert.equal(ctx.DownloadProgress({ ratio }).children[1].props.trim.to, ratio)
  }
}
let inset
const walk = n => { if (ts.isJsxAttribute(n) && n.name.getText(tree) === 'safeAreaInset') inset = n; ts.forEachChild(n, walk) }
walk(tree)
const buttons = [], rings = []
const visit = n => {
  if (ts.isJsxElement(n) && n.openingElement.tagName.getText(tree) === 'Button') buttons.push(n)
  if (ts.isJsxSelfClosingElement(n) && n.tagName.getText(tree) === 'DownloadProgress') rings.push(n)
  ts.forEachChild(n, visit)
}
visit(inset)
assert.equal(buttons.length, 1); assert.equal(rings.length, 1)
assert(!(rings[0].pos > buttons[0].pos && rings[0].end < buttons[0].end))
assert(rings[0].getText(tree).includes('ratio={progressRatio}'))
assert(buttons[0].getText(tree).includes('disabled={loading}'))
assert(inset.getText(tree).includes('fill={loading ? getTheme().accent : getTheme().bgTop}'))
assert(!src.includes('displayRatio'))
assert(!src.includes('setDisplayRatio'))
console.log('PASS: actual progress, waiting state, native interpolation, no timed progress and disabled-state isolation')
