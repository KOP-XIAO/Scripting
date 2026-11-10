// Run: node video-downloader-lite/tools/test-theme-surfaces.cjs [path-to-typescript]
// 面板取色：主题色只做极淡混色，必须保持深底以便浅色文字可读，且各主题互不相同。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require(process.argv[2] || 'typescript')
const root = path.join(__dirname, '..')
const code = ts.transpileModule(fs.readFileSync(path.join(root, 'services/theme.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText
const storage = new Map()
const ctx = { exports: {}, Storage: { get: k => storage.get(k), set: (k, v) => storage.set(k, v) }, Widget: { reloadAll: () => {} } }
vm.runInNewContext(code, ctx)
const theme = ctx.exports

const parse = hex => {
  assert.match(hex, /^#[0-9A-Fa-f]{6}$/, `valid hex: ${hex}`)
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
}
const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const lum = hex => { const [r, g, b] = parse(hex); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) }
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }

assert.equal(theme.mixHex('#0D1117', '#3FB950', 0), '#0d1117')
assert.equal(theme.mixHex('#0D1117', '#3FB950', 1), '#3fb950')
assert.equal(theme.rgbaOf('#3FB950', 0.26), 'rgba(63, 185, 80, 0.26)')
assert.equal(theme.rgbaOf('not-a-color', 0.5), 'rgba(13, 17, 23, 0.5)', 'malformed colours fall back safely')

const seen = new Set()
for (const key of Object.keys(theme.THEMES)) {
  storage.set('vdl.theme', key)
  const t = theme.getTheme()
  const surface = theme.panelColor(0.2)
  const card = theme.panelFill(0.12)
  assert.equal(card.gradient.length, 2)
  assert.equal(card.gradient[0].location, 0)
  assert.equal(card.gradient[1].location, 1)
  for (const stop of card.gradient) parse(stop.color)
  // 深底：屏幕上仍要暗，才能压住浅色文字
  assert(lum(surface) < 0.12, `${key}: surface stays dark (${surface})`)
  assert(lum(card.gradient[0].color) < 0.12, `${key}: card top stays dark`)
  assert(contrast('#E6E9EC', surface) >= 4.5, `${key}: status text readable on surface`)
  // 混色应真的带上主题色，而不是原样返回 bgTop
  assert.notEqual(surface.toLowerCase(), t.bgTop.toLowerCase(), `${key}: surface tinted`)
  assert.match(theme.panelStroke(0.62), /^rgba\(\d+, \d+, \d+, 0\.62\)$/)
  seen.add(surface)
}
assert.equal(seen.size, Object.keys(theme.THEMES).length, 'each theme owns a distinct surface')
console.log(`PASS: ${seen.size} themed surfaces stay dark, readable and distinct; malformed colours fall back`)
