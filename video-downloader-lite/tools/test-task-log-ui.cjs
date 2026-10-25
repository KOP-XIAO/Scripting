// Run: node video-downloader-lite/tools/test-task-log-ui.cjs [path-to-typescript]
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require(process.argv[2] || 'typescript')
const root = path.join(__dirname, '..')
const compile = text => ts.transpileModule(text, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText
let serial = 0, active, exported
const saved = new Map()
const Storage = { get: k => saved.has(k) ? structuredClone(saved.get(k)) : null, set: (k, v) => saved.set(k, structuredClone(v)) }
const service = { exports: {}, Storage, require: () => ({ newId: () => `task-${++serial}`, hostOf: url => new URL(url).hostname }) }
vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'services/task-log.ts'), 'utf8')), service)
const api = service.exports
const scripting = { useState: init => {
  const owner = active, i = owner.cursor++
  if (!(i in owner.slots)) owner.slots[i] = typeof init === 'function' ? init() : init
  return [owner.slots[i], value => { owner.slots[i] = value }]
}, useEffect: fn => {
  const i = active.cursor++
  if (!(i in active.slots)) { active.slots[i] = true; active.cleanups.push(fn()) }
} }
for (const tag of ['Button', 'HStack', 'Image', 'List', 'NavigationLink', 'Section', 'Spacer', 'Text', 'VStack']) scripting[tag] = tag
const modules = {
  scripting, '../services/task-log': api,
  '../services/debug': { ERROR_LINE_RE: /失败|error/, exportDebugPackage: async (extra, opts) => { exported = { extra, opts }; return '/task.md' } },
  '../utils/common': { formatDate: s => s }, '../services/theme': { getTheme: () => ({ accent: '#3FB950' }) },
}
const context = { exports: {}, require: name => { assert(modules[name], name); return modules[name] },
  React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
  ShareSheet: { present: async () => {} }, Dialog: { alert: async () => assert.fail('unexpected export error') } }
vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'components/task-logs.tsx'), 'utf8')), context)
function mount(Component, props) {
  const owner = { slots: [], cursor: 0, cleanups: [] }
  return { render() { active = owner; owner.cursor = 0; return Component(props) }, dispose() { owner.cleanups.forEach(fn => fn?.()) } }
}
const nodes = tree => {
  const out = []
  const visit = n => { if (Array.isArray(n)) return n.forEach(visit); if (!n || typeof n !== 'object') return; out.push(n); visit(n.children) }
  visit(tree); return out
}
const text = tree => nodes(tree).filter(n => n.type === 'Text').map(n => n.children.filter(x => typeof x === 'string').join('')).join('\n')
const a = api.beginTaskLog('https://a.example', 'app')
const b = api.beginTaskLog('https://b.example', 'intent')
api.appendTaskLog(a, 'A-only detail'); api.appendTaskLog(b, 'B-only detail')
const home = mount(context.exports.TaskLogsSection, { limit: 3 })
const first = home.render()
assert.equal(nodes(first).filter(n => n.type === 'NavigationLink').length, 2)
const aLink = nodes(first).find(n => n.type === 'NavigationLink' && n.props.destination.props.task.id === a)
const detail = mount(aLink.props.destination.type, aLink.props.destination.props)
assert(text(detail.render()).includes('A-only detail'))
assert(!text(detail.render()).includes('B-only detail'))
api.appendTaskLog(a, 'A later step')
api.finishTaskLog(a, 'success', 'A complete')
assert(text(home.render()).includes('A complete'))
assert(text(detail.render()).includes('A later step'))
const detailTree = detail.render()
const line = nodes(detailTree).find(n => n.type === 'Text' && text(n).includes('A later step'))
assert.equal(line.props.lineLimit, undefined)
;(async () => {
  nodes(detailTree).find(n => n.type === 'Button').props.action()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(exported.extra.taskId, a)
  assert(exported.opts.logs.join('\n').includes('A-only detail'))
  assert(!exported.opts.logs.join('\n').includes('B-only detail'))
  home.dispose(); detail.dispose()
  console.log('PASS: task summaries, live detail refresh, complete lines, isolated export and subscription cleanup')
})().catch(error => { console.error(error); process.exit(1) })
