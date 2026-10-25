// Offline theme persistence and readability checks.
// NODE_PATH=<node_modules containing esbuild> node tools/test-themes.cjs
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const esbuild = require("esbuild")
const root = path.join(__dirname, "..")
const values = new Map()
let reloads = 0
const context = {
  module: { exports: {} },
  Storage: { get(key) { return values.get(key) }, set(key, value) { values.set(key, value) } },
  Widget: { reloadAll() { reloads++ } },
}
vm.createContext(context)
vm.runInContext(esbuild.buildSync({ entryPoints: [path.join(root, "services/theme.ts")], bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text, context)
const T = context.module.exports
const luminance = color => color.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0)
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)
assert.equal(Object.keys(T.THEMES).length, 8)
for (const key of Object.keys(T.THEMES)) {
  T.setThemeKey(key)
  assert.equal(T.getThemeKey(), key)
  assert.equal(T.THEMES[key].key, key)
  const asset = T.THEMES[key].backgroundAsset
  if (asset) assert.ok(fs.existsSync(path.join(root, "assets", asset)), `Missing ${asset}`)
}
console.log("PASS: all 8 theme preferences persist and background assets exist")
for (const key of ["film", "space"]) {
  const original = JSON.stringify(T.THEMES[key])
  for (const accent of Object.keys(T.ACCENTS)) {
    T.setThemeKey(key)
    T.setAccentKey(accent)
    const theme = T.getTheme()
    assert.equal(theme.backgroundAsset, `theme-${key}.png`)
    for (const color of [theme.ink, theme.sub, theme.accent, theme.warn]) {
      assert.ok(contrast(color, theme.cardTop) >= 4.5, `${key}/${accent} unreadable on top surface`)
      assert.ok(contrast(color, theme.cardBottom) >= 4.5, `${key}/${accent} unreadable on bottom surface`)
    }
    assert.ok(contrast(theme.badgeInk, theme.accent) >= 4.5, `${key}/${accent} badge unreadable`)
  }
  assert.equal(JSON.stringify(T.THEMES[key]), original)
}
console.log("PASS: film/space support all 9 accent selections with readable text and badges; palettes are not mutated")
values.set(T.THEME_KEY, "missing-theme")
values.set(T.ACCENT_KEY, "missing-accent")
assert.equal(T.getThemeKey(), "ticket")
assert.equal(T.getAccentKey(), "theme")
assert.equal(reloads, 44)
console.log("PASS: invalid preferences fall back safely and changes request widget refresh")
