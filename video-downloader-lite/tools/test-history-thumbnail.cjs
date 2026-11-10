// Run: node video-downloader-lite/tools/test-history-thumbnail.cjs [path-to-typescript]
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require(process.argv[2] || 'typescript')
const root = path.join(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8')
const tree = ts.createSourceFile('index.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
assert.equal(tree.parseDiagnostics.length, 0)
const component = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'VideoThumb')
assert(component)
const code = ts.transpileModule(component.getText(tree), {
  compilerOptions: { jsx: ts.JsxEmit.React },
}).outputText
let reads = [], logs = [], mode = 'ok'
const image = { width: 216, height: 138 }
const context = {
  React: { createElement: (type, props) => ({ type, props }) },
  Image: 'Image',
  UIImage: { fromFile: file => {
    reads.push(file)
    if (mode === 'throw') throw new Error('unreadable')
    return mode === 'missing' ? null : image
  } },
  appendDebug: line => logs.push(line),
}
vm.runInNewContext(code, context)
const render = p => context.VideoThumb({ path: p })
// 无路径：明确的待生成占位，不读盘
const empty = render(undefined)
assert.equal(empty.type, 'Image')
assert.equal(empty.props.systemName, 'photo')
assert.equal(empty.props.accessibilityLabel, '视频封面待生成')
assert.equal(reads.length, 0)
// 有路径：首帧就带已解码图片，不依赖 filePath 异步加载
const ok = render('/thumbs/new.jpg')
assert.equal(ok.type, 'Image')
assert.equal(ok.props.image, image)
assert.equal(ok.props.filePath, undefined)
assert.equal(ok.props.scaleToFill, true)
assert.equal(ok.props.clipShape.cornerRadius, 6)
// 每次渲染重新读盘：回填会覆盖同一路径，缓存旧 null 会让封面一直空着
render('/thumbs/new.jpg')
assert.equal(reads.length, 2)
const missing = render('/thumbs/missing.jpg')
mode = 'missing'
const missingRead = render('/thumbs/missing.jpg')
assert.equal(missingRead.props.systemName, 'photo')
assert.equal(missingRead.props.accessibilityLabel, '视频封面暂时无法读取')
mode = 'throw'
const thrown = render('/thumbs/broken.jpg')
assert.equal(thrown.props.accessibilityLabel, '视频封面暂时无法读取')
assert(logs.length >= 2)
assert(!source.includes('imgTick'))
assert(source.indexOf('initialHistory = await listHistory(50)') < source.indexOf('await Navigation.present'))
console.log('PASS: first-render image, no stale cache, explicit placeholders, corrupt-file fallback and startup preload')
