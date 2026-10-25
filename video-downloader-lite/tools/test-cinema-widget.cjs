// Run: node video-downloader-lite/tools/test-cinema-widget.cjs [path-to-typescript]
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require(process.argv[2] || 'typescript')
const root = path.join(__dirname, '..')
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
}).outputText
const themeCode = compile('services/theme.ts'), widgetCode = compile('widget.tsx')
const common = { exports: {} }
vm.runInNewContext(compile('utils/common.ts'), common)
const latest = { title: '一段很长的视频标题，用于检查胶片影院的双行信息布局', fileName: 'sample.mp4',
  bytes: 12345678, durationSec: 90, createdAt: '2026-10-25T12:00:00Z', kind: 'direct',
  resolution: '1080p', format: 'MP4', host: 'video.example' }
const snap = { latest, second: { ...latest, title: '前一条视频' }, totalCount: 2, totalBytes: 24691356 }
function render({ theme = 'terminal', glyph = 'clapperboard', family = 'systemSmall', style = 'cinema', snapshot = snap } = {}) {
  const values = new Map([['vdl.theme', theme], ['vdl.badgeGlyph', glyph], ['vdl.widgetStyle', style]])
  let presented
  const Widget = { family, reloadAll: () => {}, present: view => { presented = view } }
  const themeContext = { exports: {}, Storage: { get: k => values.get(k), set: (k, v) => values.set(k, v) }, Widget }
  vm.runInNewContext(themeCode, themeContext)
  const scripting = { Widget, Script: { directory: root, createRunSingleURLScheme: () => 'scripting://download?autopaste=1' } }
  for (const tag of ['HStack', 'Image', 'Link', 'Spacer', 'Text', 'VStack', 'ZStack']) scripting[tag] = tag
  const modules = { scripting, './services/theme': themeContext.exports,
    './services/history': { getWidgetSnapshot: () => snapshot }, './utils/common': common.exports }
  const context = { exports: {}, require: k => { assert(modules[k], k); return modules[k] },
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) } }
  vm.runInNewContext(widgetCode, context)
  assert(presented)
  if (style === 'cinema') assert.equal(presented.type.name, 'CinemaView')
  const nodes = []
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit)
    if (!node || typeof node !== 'object') return
    if (typeof node.type === 'function') return visit(node.type(node.props))
    nodes.push(node); visit(node.children)
  }
  visit(presented)
  for (const node of nodes) if (node.type === 'Image' && node.props.filePath) assert(fs.existsSync(node.props.filePath), node.props.filePath)
  if (style === 'cinema') {
    const size = family === 'systemMedium' ? 'medium' : 'small'
    assert(nodes.some(n => n.props.filePath?.endsWith(`widget-style-cinema-${size}.png`)))
    assert(nodes.some(n => n.props.filePath?.endsWith(`widget-style-badge-cinema-${glyph}-${theme}.png`)))
    assert(nodes.some(n => n.props.widgetURL === 'scripting://download?autopaste=1'))
    if (snapshot?.latest) assert(nodes.some(n => n.type === 'Text' && n.children.includes(latest.title) && n.props.lineLimit?.max === 2))
    else assert(nodes.some(n => n.type === 'Text' && n.children.includes('暂无下载记录')))
    if (family === 'systemMedium') assert(nodes.some(n => n.type === 'Link' && n.props.url === 'scripting://download?autopaste=1'))
  }
  return themeContext.exports
}
const themes = render()
let count = 0
for (const theme of Object.keys(themes.THEMES)) for (const { key: glyph } of themes.BADGE_GLYPHS)
  for (const family of ['systemSmall', 'systemMedium']) { render({ theme, glyph, family }); count++ }
for (const family of ['systemSmall', 'systemMedium']) render({ family, snapshot: null })
for (const { key: style } of themes.WIDGET_STYLES) for (const family of ['systemSmall', 'systemMedium']) render({ style, family })
console.log(`PASS: ${count} cinema palette/icon/size combinations, empty states, links and all existing styles`)
