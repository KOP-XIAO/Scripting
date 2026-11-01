#!/usr/bin/env node
'use strict';
// Execute the real OCR -> root View -> save workflow with native APIs kept in memory.
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const ROOT = path.resolve(__dirname, '..');
const LEGEND = '起＝始发站，过＝经停站，终＝终点站';
const screenshot = route => `G1234\n2099-06-18\n09:00\n09:18\n${route}`;
let bundled;

async function compile() {
  const result = await esbuild.build({
    stdin: { contents: 'import "./index"; export { parseTripText } from "./services/parse";', resolveDir: ROOT, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['scripting'], jsxFactory: '__jsx', jsxFragment: '__Fragment', logLevel: 'silent',
  });
  assert.equal(result.warnings.length, 0, 'source bundle must have no warnings');
  bundled = result.outputFiles[0].text;
}

function fixture(text) {
  const storage = new Map(), states = [];
  let cursor = 0, root, tree, reloads = 0, picks = 0, recognitions = 0;
  const native = new Proxy({
    __esModule: false,
    Navigation: { present: async ({ element }) => { root = element; }, useDismiss: () => () => {} },
    Script: { exit() {} },
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useEffect() {},
    useObservable: () => ({ value: 'home' }),
  }, { get: (target, key) => key in target ? target[key] : key });
  const sandbox = {
    module: { exports: {} }, console,
    __jsx: (type, props, ...children) => ({ type, props: { ...props, children } }),
    __Fragment: 'Fragment',
    require(name) { assert.equal(name, 'scripting'); return native; },
    Storage: { get: key => storage.get(key), set: (key, value) => { storage.set(key, value); return true; }, remove: key => storage.delete(key) },
    Widget: { reloadAll() { reloads++; } },
    Photos: { pick: async () => { picks++; return [{ uiImage: async () => ({}) }]; } },
    PHPickerFilter: { images: () => 'mock-images' },
    Vision: { recognizeText: async () => { recognitions++; return { text }; } },
    Dialog: { alert: async options => { throw new Error(`Unexpected alert: ${JSON.stringify(options)}`); } },
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(bundled, sandbox, { filename: 'review-states-memory.cjs' });
  assert.equal(typeof root?.type, 'function', 'Navigation.present must capture the actual root View');
  const render = () => { cursor = 0; tree = root.type(root.props); return tree; };
  // Child components stay opaque: review fields are already nodes in the root output.
  const nodes = (value = tree) => {
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) return value.flatMap(item => nodes(item));
    if (!value.type || !value.props) return [];
    return [value, ...Object.values(value.props).flatMap(item => nodes(item))];
  };
  const one = (type, title) => {
    const found = nodes().filter(node => node.type === type && node.props.title === title);
    assert.equal(found.length, 1, `expected one ${type} titled ${title}`);
    return found[0];
  };
  const texts = () => nodes().filter(node => node.type === 'Text').map(node => node.props.children.flat(Infinity).join(''));
  render();
  return {
    storage, render, nodes, texts, one,
    parse: () => sandbox.module.exports.parseTripText(text),
    get reloads() { return reloads; },
    async ocr() {
      one('Button', '从相册选行程截图识别').props.action();
      await new Promise(resolve => setImmediate(resolve)); // The button uses void runOCR().
      render();
      assert.equal(picks, 1, 'must use Photos.pick');
      assert.equal(recognitions, 1, 'must run Vision.recognizeText');
      one('Button', '保存行程');
    },
  };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
function label(f, expected) {
  assert.ok(f.texts().includes(expected), `missing visible review label: ${expected}`);
}

test('OCR review shows intermediate departure and terminal arrival before save', async () => {
  const f = fixture(screenshot('过深圳北 → 终香港西九龙'));
  const facts = JSON.parse(JSON.stringify(f.parse().railStationStates));
  assert.deepEqual(facts, { code: 'G1234', stations: [
    { station: '深圳北', state: 'intermediate' }, { station: '香港西九龙', state: 'terminal' },
  ] });
  console.log(`parser railStationStates: ${JSON.stringify(facts)}`);
  await f.ocr();
  assert.equal(f.storage.has('rail.trips'), false, 'review must precede saving');
  assert.equal(f.one('TextField', '出发车站').props.value, '深圳北');
  assert.equal(f.one('TextField', '到达车站').props.value, '香港西九龙');
  label(f, '出发车站 · 过');
  label(f, '到达车站 · 终');
  label(f, LEGEND);
});

test('origin and intermediate badges stay attached to the correct endpoint', async () => {
  const f = fixture(screenshot('起深圳北 → 过香港西九龙'));
  await f.ocr();
  label(f, '出发车站 · 起');
  label(f, '到达车站 · 过');
  label(f, LEGEND);
  assert.equal(f.one('TextField', '出发车站').props.value, '深圳北');
  assert.equal(f.one('TextField', '到达车站').props.value, '香港西九龙');
});

test('rail endpoints without explicit facts remain unrecognized', async () => {
  const f = fixture(screenshot('深圳北 → 香港西九龙'));
  assert.equal(f.parse().railStationStates, undefined);
  await f.ocr();
  label(f, '出发车站 · 未识别');
  label(f, '到达车站 · 未识别');
  label(f, LEGEND);
  assert.equal(f.one('TextField', '出发车站').props.value, '深圳北');
  assert.equal(f.one('TextField', '到达车站').props.value, '香港西九龙');
});

test('code or station edits stop displaying facts that no longer match', async () => {
  for (const [title, value, from, to] of [
    ['车次', ' g 9 9 9 9 ', '未识别', '未识别'],
    ['出发车站', '深圳东', '未识别', '终'],
    ['到达车站', '香港九龙', '过', '未识别'],
  ]) {
    const f = fixture(screenshot('过深圳北 → 终香港西九龙'));
    await f.ocr();
    f.one('TextField', title).props.onChanged(value);
    f.render();
    label(f, `出发车站 · ${from}`);
    label(f, `到达车站 · ${to}`);
    assert.equal(f.one('TextField', title).props.value, title === '车次' ? 'G9999' : value);
    assert.equal(f.storage.has('rail.trips'), false);
  }
});

test('flight review keeps plain airport labels and has no rail status legend', async () => {
  for (const text of [
    'CA1234\n2099-06-18\n09:00\n11:18\n北京首都T3 → 上海虹桥T2',
    screenshot('过深圳北 → 终香港西九龙'),
  ]) {
    const f = fixture(text);
    await f.ocr();
    if (f.parse().mode === 'rail') {
      const button = f.nodes().find(node => node.type === 'Button' &&
        node.props.children.flat(Infinity).some(child => child?.type === 'Text' && child.props.children.join('') === '航班'));
      assert.ok(button, 'must find the actual flight mode button');
      button.props.action();
      f.render();
    }
    label(f, '出发机场');
    label(f, '到达机场');
    assert.equal(f.one('TextField', '出发机场').props.value, f.parse().fromPlace);
    assert.equal(f.one('TextField', '到达机场').props.value, f.parse().toPlace);
    assert.equal(f.texts().some(text => /^(?:出发|到达)车站|起＝始发站/.test(text)), false);
  }
});

test('save preserves parsed metadata, clean values, and the unmodified OCR text', async () => {
  const raw = screenshot('过深圳北 → 终香港西九龙') +
    '\n经停站\n起 广州南 始发 08:20\n过 深圳北 08:58 09:00 2分\n终 香港西九龙 09:18 终到';
  const f = fixture(raw);
  const parsed = JSON.parse(JSON.stringify(f.parse()));
  assert.equal(parsed.railStops.length, 3, 'fixture must exercise timetable metadata too');
  await f.ocr();
  label(f, '出发车站 · 过');
  label(f, '到达车站 · 终');
  f.one('Toggle', '查看识别原文（用于排查识别不准）').props.onChanged(true);
  f.one('TextField', '备注').props.onChanged('Regression fixture');
  f.render();
  label(f, raw);
  assert.equal(f.storage.has('rail.trips'), false);
  assert.equal(f.reloads, 0);
  f.one('Button', '保存行程').props.action();
  f.render();
  const saved = JSON.parse(JSON.stringify(f.storage.get('rail.trips')));
  assert.equal(saved.length, 1);
  const { id, createdAt, note, ...trip } = saved[0];
  assert.deepEqual(trip, parsed, 'saving must preserve every parsed field and station/timetable fact');
  assert.ok(id);
  assert.ok(Number.isFinite(Date.parse(createdAt)));
  assert.equal(note, 'Regression fixture');
  assert.equal(f.reloads, 1, 'saving refreshes widgets exactly once');
  assert.equal(f.nodes().some(node => node.type === 'Button' && node.props.title === '保存行程'), false);
  assert.equal(f.nodes().some(node => node.type === 'Toggle' && node.props.title === '查看识别原文（用于排查识别不准）'), false);
});

(async () => {
  await compile();
  let failed = 0;
  for (const [name, run] of tests) {
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failed++; console.error(`FAIL ${name}\n${error.message}`); }
  }
  console.log(`${tests.length - failed}/${tests.length} review-state groups passed`);
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
