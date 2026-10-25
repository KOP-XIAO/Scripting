// Run: node video-downloader-lite/tools/test-appearance-groups.cjs [path-to-typescript]
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require(process.argv[2] || 'typescript')
const root = path.join(__dirname, '..')
const compile = text => ts.transpileModule(text, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText
const values = new Map()
const Storage = { get: k => values.get(k), set: (k, v) => values.set(k, v) }
const themeContext = { exports: {}, Storage, Widget: { reloadAll: () => {} } }
vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'services/theme.ts'), 'utf8')), themeContext)
const theme = themeContext.exports
const source = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8')
const tree = ts.createSourceFile('index.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const fn = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'SettingsPage')
const ctx = { ...theme, React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
  useState: init => [typeof init === 'function' ? init() : init, () => {}],
  getYuanbaoCookie: () => '', Script: { directory: root }, VERSION: 'test',
  SAVE_MODE_LABELS: { keep: '保留' }, WX_CODEC_LABELS: { h264: 'H264' } }
for (const tag of ['List', 'Section', 'HStack', 'VStack', 'Image', 'Text', 'Spacer', 'Button', 'RoundedRectangle', 'TextField', 'Toggle', 'Link', 'ZStack']) ctx[tag] = tag
vm.runInNewContext(compile(fn.getText(tree)), ctx)
const rendered = ctx.SettingsPage({ prefs: { defaultSaveMode: 'keep', wxCodec: 'h264' }, onSave: () => {} })
const visit = (node, fn) => {
  if (!node) return
  if (Array.isArray(node)) return node.forEach(n => visit(n, fn))
  if (typeof node !== 'object') return
  fn(node); visit(node.children, fn)
}
const text = node => { const out = []; visit(node, n => { if (n.type === 'Text') out.push(n.children.filter(x => typeof x === 'string').join('')) }); return out.join(' ') }
const sections = rendered.children.filter(n => n?.type === 'Section')
const find = title => sections.find(s => s.props.title === title || text(s.props.header) === title)
const color = find('界面配色'), icon = find('小组件入口图标'), style = find('小组件背景样式')
assert(color && icon && style)
const buttons = node => { const out = []; visit(node, n => { if (n.type === 'Button') out.push(n) }); return out }
assert.equal(buttons(color).length, Object.keys(theme.THEMES).length)
assert.equal(buttons(icon).length, theme.BADGE_GLYPHS.length)
assert.equal(buttons(style).length, theme.WIDGET_STYLES.length)
assert.equal(buttons(style).length, 6)
buttons(color)[1].props.action()
assert(values.has('vdl.theme')); assert(!values.has('vdl.badgeGlyph')); assert(!values.has('vdl.widgetStyle'))
const palette = values.get('vdl.theme')
buttons(icon)[1].props.action()
assert.equal(values.get('vdl.theme'), palette)
assert.equal(values.get('vdl.badgeGlyph'), theme.BADGE_GLYPHS[1].key)
buttons(style)[4].props.action()
assert.equal(values.get('vdl.widgetStyle'), 'cyberpunk')
assert.equal(values.get('vdl.theme'), palette)
assert.equal(values.get('vdl.badgeGlyph'), theme.BADGE_GLYPHS[1].key)
buttons(style)[5].props.action()
assert.equal(values.get('vdl.widgetStyle'), 'cinema')
assert.equal(values.get('vdl.theme'), palette)
assert.equal(values.get('vdl.badgeGlyph'), theme.BADGE_GLYPHS[1].key)
const styleRows = []
visit(style, n => { if (n.type === 'HStack' && buttons(n).length) styleRows.push(buttons(n).length) })
assert.deepEqual(styleRows, [3, 3])
for (const group of [icon, style]) visit(group, n => { if (n.type === 'Image' && n.props.filePath) assert(fs.existsSync(n.props.filePath), n.props.filePath) })
console.log('PASS: distinct groups, all palette/icon/style choices, independent persistence, asset paths and three-column layout')
