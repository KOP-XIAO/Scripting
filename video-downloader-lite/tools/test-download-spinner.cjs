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
assert(inset.getText(tree).includes('fill={loading || celebrate ? getTheme().accent : panelColor(0.16)}'))
let surface
const findSurface = n => {
  if (ts.isJsxElement(n) && n.openingElement.tagName.getText(tree) === 'ZStack'
    && n.getText(tree).includes('<Button')) surface = n
  ts.forEachChild(n, findSurface)
}
findSurface(inset)
const context = {
  React: { createElement: (type, props, ...children) => ({ type, props, children }) },
  getTheme: () => ({ accent: '#3FB950', accentSoft: '#3FB95088', bgTop: '#0D1117', bgBottom: '#0C1A12' }),
  panelColor: level => `panel:${level}`,
  panelStroke: alpha => `stroke:${alpha}`,
  rgbaOf: (hex, alpha) => `rgba:${hex}:${alpha}`,
  pasteAndDownload: () => {},
}
for (const name of ['ZStack', 'Circle', 'Button', 'Image', 'DownloadProgress']) context[name] = name
vm.runInNewContext(ts.transpileModule(
  `function render(loading, celebrate, progressRatio) { return (${surface.getText(tree)}) }`,
  { compilerOptions: { jsx: ts.JsxEmit.React } },
).outputText, context)
for (const [loading, celebrate] of [[false, false], [true, false], [true, true], [false, true], [false, false]]) {
  const rendered = context.render(loading, celebrate, 0.63)
  const [circle, button, indicator] = rendered.children
  assert.equal(button.props.disabled, loading)
  assert.equal(button.children[0].props.opacity, loading || celebrate ? 0 : 1)
  assert.equal(circle.props.fill, loading || celebrate ? '#3FB950' : 'panel:0.16')
  assert.equal(circle.props.stroke.shapeStyle, loading || celebrate ? '#3FB950' : 'stroke:0.62')
  // 空闲态用主题色柔光托住按钮，进行中/完成态不再叠阴影
  if (loading || celebrate) assert.equal(circle.props.shadow, undefined)
  else assert.equal(circle.props.shadow.color, 'rgba:#3FB950:0.22')
  if (celebrate) assert.equal(indicator.props.systemName, 'checkmark')
  else if (loading) { assert.equal(indicator.type, 'DownloadProgress'); assert.equal(indicator.props.ratio, 0.63) }
  else { assert.equal(indicator, null); assert.equal(button.children[0].props.systemName, 'tray.and.arrow.down') }
}
assert(src.indexOf('const action = await postDownloadAction') < src.indexOf('if (outcome.files.length > 0) setCelebrate(true)'))
assert(src.includes('<ConfettiOverlay onFinish={() => setCelebrate(false)} />'))
assert(!src.includes('displayRatio'))
assert(!src.includes('setDisplayRatio'))
// 状态卡改主题面板；只剩诊断页的终端输出窗保留纯黑
const blackPanes = src.match(/background="#0D1117"/g) || []
assert.equal(blackPanes.length, 1, 'only the diagnostics terminal keeps a black pane')
assert(src.includes('fill={panelFill(0.10)}') && src.includes('fill={panelFill(0.07)}'))
assert(src.includes('panelStroke(0.3)') && src.includes('panelStroke(0.24)'))
assert(src.includes('rgbaOf(getTheme().accent, 0.16)'), 'status icon chip tinted by theme accent')
console.log('PASS: actual progress, waiting state, native interpolation, themed cards and accent-lit action button')
