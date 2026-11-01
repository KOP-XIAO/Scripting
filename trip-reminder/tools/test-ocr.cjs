#!/usr/bin/env node
'use strict';
// NODE_PATH=<node_modules containing esbuild> node trip-reminder/tools/test-ocr.cjs
// Synthetic UIImage/Photos/Vision only; bundle and images remain in memory.
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const ROOT = path.resolve(__dirname, '..');
const bundled = esbuild.buildSync({
  stdin: { contents: 'export * from "./services/ocr"; export { parseTripText, railStationState } from "./services/parse";', resolveDir: ROOT, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false,
}).outputFiles[0].text;
const plain = value => JSON.parse(JSON.stringify(value));
const candidate = (content, x, y, width, height) => ({ content, confidence: 0.95, boundingBox: { x, y, width, height } });
const initialText = 'G1234\n复兴号\n08:32\n过\n】北京南\n检票口：6A\n08:50\n上海虹桥';
const clocks = [candidate('08:32', 0.06, 0.68, 0.18, 0.08), candidate('08:50', 0.73, 0.68, 0.18, 0.08)];
const stationRow = [
  candidate('过', 0.06, 0.59, 0.03, 0.05), candidate('北京南', 0.10, 0.59, 0.17, 0.05),
  candidate('终', 0.69, 0.59, 0.03, 0.05), candidate('上海虹桥', 0.73, 0.59, 0.20, 0.05),
];
const initialCandidates = [...clocks, stationRow[0], { ...stationRow[1], content: '】北京南' }, stationRow[3]];
const flip = c => ({ ...c, boundingBox: { ...c.boundingBox, y: 1 - c.boundingBox.y - c.boundingBox.height } });

function fixture({ text = initialText, candidates = initialCandidates, cropResults = [], size = [1200, 806], rendered = true, renderFailure, photos, vision } = {}) {
  const calls = [], renders = [], effects = [];
  const forbidden = label => () => { effects.push(label); throw new Error(`Unexpected private-data operation: ${label}`); };
  const image = { width: size[0], height: size[1], scale: 1,
    toPNGData: forbidden('encode'), toJPEGData: forbidden('encode'),
    toPNGBase64String: forbidden('encode'), toJPEGBase64String: forbidden('encode') };
  if (rendered) image.renderedIn = (target, source) => {
    renders.push({ target: plain(target), source: plain(source) });
    if (renderFailure instanceof Error) throw renderFailure;
    return renderFailure === null ? null : { crop: renders.length };
  };
  const context = { module: { exports: {} },
    Photos: photos ?? { pick: async options => { assert.equal(options.limit, 1); return [{ uiImage: async () => image }]; } },
    PHPickerFilter: { images: () => 'images' },
    Vision: vision ?? { recognizeText: async (input, options) => {
      calls.push({ input, options: plain(options) });
      if (input === image) return { text, candidates };
      const next = cropResults[input.crop - 1];
      if (next instanceof Error) throw next;
      return next ?? { text: '', candidates: [] };
    } },
    FileManager: new Proxy({}, { get: (_, key) => forbidden(`file:${String(key)}`) }),
    Storage: new Proxy({}, { get: (_, key) => forbidden(`storage:${String(key)}`) }),
    fetch: forbidden('fetch'), Request: forbidden('Request'), URLSession: forbidden('URLSession'),
    console: { log: forbidden('log'), warn: forbidden('log'), error: forbidden('log') },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(bundled, context, { filename: 'ocr-memory.cjs' });
  return { ...context.module.exports, context, image, calls, renders, effects };
}

function cropResponse(bottomOrigin = true) {
  const source = bottomOrigin ? [...clocks, ...stationRow] : [...clocks, ...stationRow].map(flip);
  const mid = 0.28, height = 0.08;
  const top = mid - height, bottom = mid + 2.5 * height, span = bottom - top;
  const offset = bottomOrigin ? 1 - bottom : top;
  return { text: '08:32\n过\n北京南\n08:50\n终\n上海虹桥', candidates: source.map(c => ({
    ...c, boundingBox: { ...c.boundingBox, y: (c.boundingBox.y - offset) / span, height: c.boundingBox.height / span },
  })) };
}
function parsed(f, result) {
  return f.parseTripText(result.text, undefined, 'auto', result.candidates.map(c => ({
    content: c.content, x: c.boundingBox.x, y: c.boundingBox.y, w: c.boundingBox.width, h: c.boundingBox.height,
  })));
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const tests = [];
const test = (name, run) => tests.push([name, run]);

test('missing blue badge retries mirrored clock band, retains raw and recovers both station states', async () => {
  const before = plain(initialCandidates);
  const wrongRegion = { text: '乘车人\n终\n无关站名', candidates: [candidate('终 无关站名', 0.1, 0.2, 0.2, 0.1)] };
  const f = fixture({ cropResults: [wrongRegion, cropResponse()] });
  const result = await f.recognizeFromPickedScreenshot();
  assert.equal(result.ok, true);
  assert.equal(result.text, initialText);
  assert.deepEqual(initialCandidates, before, 'baseline candidates must be untouched');
  assert.equal(f.calls.length, 3, 'one baseline and at most two crops');
  assert.equal(result.candidates.length, initialCandidates.length + 4);
  assert.equal(result.candidates.filter(c => /^08:(32|50)$/.test(c.content)).length, 2, 'verified crop clocks must not duplicate the baseline columns');
  assert.ok(!result.candidates.some(c => c.content.includes('无关')));
  const mapped = result.candidates.slice(initialCandidates.length);
  stationRow.forEach((original, i) => {
    assert.equal(mapped[i].content, original.content);
    for (const key of ['x', 'y', 'width', 'height']) close(mapped[i].boundingBox[key], original.boundingBox[key]);
  });
  const trip = parsed(f, result);
  assert.equal(trip.fromPlace, '北京南');
  assert.equal(trip.toPlace, '上海虹桥');
  assert.equal(f.railStationState(trip, '北京南'), 'intermediate');
  assert.equal(f.railStationState(trip, '上海虹桥'), 'terminal');
  assert.equal(f.calls[0].options.minimumTextHeight, 0.005);
  assert.deepEqual(f.calls[1].options.customWords, ['起', '过', '终']);
  assert.equal(f.calls[1].options.usesLanguageCorrection, true);
  assert.deepEqual(f.effects, []);
});

test('top-left wrapper boxes map the first accepted band without a second retry', async () => {
  const f = fixture({ candidates: initialCandidates.map(flip), cropResults: [cropResponse(false)] });
  const result = await f.recognizeFromPickedScreenshot();
  assert.equal(f.calls.length, 2);
  const mapped = result.candidates.slice(initialCandidates.length);
  stationRow.map(flip).forEach((c, i) => close(mapped[i].boundingBox.y, c.boundingBox.y));
  const trip = parsed(f, result);
  assert.equal(f.railStationState(trip, '上海虹桥'), 'terminal');
});

test('overlapping orientation bands must also match remapped clock positions', async () => {
  const candidates = initialCandidates.map(c => ({ ...c, boundingBox: { ...c.boundingBox, y: c.boundingBox.y - 0.22 } }));
  const f = fixture({ candidates, cropResults: [cropResponse(), cropResponse()] });
  const result = await f.recognizeFromPickedScreenshot();
  assert.equal(f.calls.length, 3, 'clock text alone cannot decide the orientation');
  const mapped = result.candidates.slice(initialCandidates.length);
  stationRow.forEach((c, i) => close(mapped[i].boundingBox.y, c.boundingBox.y - 0.22));
  assert.equal(f.railStationState(parsed(f, result), '上海虹桥'), 'terminal');
});

test('complete endpoints and explicit states skip rendering and retry', async () => {
  const f = fixture({ text: 'G1234\n08:32\n08:50\n过 北京南\n终 上海虹桥' });
  const result = await f.recognizeFromPickedScreenshot();
  assert.equal(result.ok, true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.renders.length, 0);
});

test('both intermediate endpoints are complete and do not need terminal inference', async () => {
  const f = fixture({ text: 'G1234\n08:32\n08:50\n过 北京南\n过 上海虹桥' });
  const result = await f.recognizeFromPickedScreenshot();
  assert.equal(f.calls.length, 1);
  assert.equal(f.railStationState(parsed(f, result), '上海虹桥'), 'intermediate');
});

test('known station names with a missing state still retry', async () => {
  const f = fixture({ text: 'G1234\n08:32\n08:50\n出发站：过北京南\n到达站：上海虹桥', cropResults: [cropResponse(false)], candidates: initialCandidates.map(flip) });
  const result = await f.recognizeFromPickedScreenshot();
  assert.equal(f.calls.length, 2);
  assert.equal(f.railStationState(parsed(f, result), '上海虹桥'), 'terminal');
});

test('unavailable rendering and invalid image sizes retain baseline results', async () => {
  for (const options of [{ rendered: false }, { size: [0, 806] }, { size: [1200, NaN] }]) {
    const f = fixture(options), result = await f.recognizeFromPickedScreenshot();
    assert.equal(result.ok, true);
    assert.equal(result.text, initialText);
    assert.deepEqual(plain(result.candidates), initialCandidates);
    assert.equal(f.calls.length, 1);
  }
});

test('null, throwing and failed crop OCR fall back without losing the successful baseline', async () => {
  for (const options of [{ renderFailure: null }, { renderFailure: new Error('unsupported') }, { cropResults: [new Error('crop recognition'), new Error('crop recognition')] }]) {
    const f = fixture(options), result = await f.recognizeFromPickedScreenshot();
    assert.equal(result.ok, true);
    assert.equal(result.text, initialText);
    assert.deepEqual(plain(result.candidates), initialCandidates);
    assert.equal(f.renders.length, 2);
    assert.ok(f.calls.length <= 3);
  }
});

test('native property read failures during enhancement retain the original result', async () => {
  const unreadableCrop = { candidates: [] };
  Object.defineProperty(unreadableCrop, 'text', { get() { throw new Error('native crop text unavailable'); } });
  const f = fixture({ cropResults: [unreadableCrop, unreadableCrop] });
  const result = await f.recognizeFromPickedScreenshot();
  assert.equal(result.ok, true);
  assert.equal(result.text, initialText);
  assert.deepEqual(plain(result.candidates), initialCandidates);
  const missingSize = fixture();
  Object.defineProperty(missingSize.image, 'width', { get() { throw new Error('native width unavailable'); } });
  const baseline = await missingSize.recognizeFromPickedScreenshot();
  assert.equal(baseline.ok, true);
  assert.equal(baseline.text, initialText);
  assert.equal(missingSize.calls.length, 1);
});

test('both original clock values are required before accepting any candidate', async () => {
  for (const text of ['终 上海虹桥', '08:32\n终 上海虹桥', '08:32\n08:51\n终 上海虹桥']) {
    const f = fixture({ cropResults: [{ text, candidates: [candidate('终 上海虹桥', 0.7, 0.2, 0.25, 0.1)] }] });
    const result = await f.recognizeFromPickedScreenshot();
    assert.deepEqual(plain(result.candidates), initialCandidates);
    assert.equal(f.calls.length, 3);
  }
});

test('a clock-verified crop cannot infer a missing terminal badge', async () => {
  const crop = cropResponse(false);
  crop.text = crop.text.replace('终\n', '');
  crop.candidates = crop.candidates.filter(c => c.content !== '终');
  const f = fixture({ candidates: initialCandidates.map(flip), cropResults: [crop] });
  const result = await f.recognizeFromPickedScreenshot();
  assert.equal(f.railStationState(parsed(f, result), '上海虹桥'), undefined);
});

test('flight, no train code, paper rows, duplicate clocks and overlapping columns skip retries', async () => {
  for (const options of [
    { text: 'CA1234\n机场\n08:32\n08:50' },
    { text: '08:32\n08:50\n北京南' },
    { candidates: [clocks[0]] },
    { candidates: [clocks[0], { ...clocks[1], boundingBox: { ...clocks[1].boundingBox, y: 0.2 } }] },
    { text: 'G1234\n08:32\n08:32', candidates: [clocks[0], { ...clocks[1], content: '08:32' }] },
    { candidates: [clocks[0], { ...clocks[1], boundingBox: { ...clocks[1].boundingBox, x: 0.1 } }] },
    { candidates: [clocks[0], { ...clocks[1], boundingBox: { ...clocks[1].boundingBox, y: NaN } }] },
  ]) {
    const f = fixture(options), result = await f.recognizeFromPickedScreenshot();
    assert.equal(result.ok, true);
    assert.equal(f.calls.length, 1);
    assert.equal(f.renders.length, 0);
  }
});

test('retry crops cover the full width, use source units and cap upscaling and output pixels', async () => {
  for (const size of [[1200, 806], [6000, 12000]]) {
    const f = fixture({ size });
    await f.recognizeFromPickedScreenshot();
    assert.equal(f.renders.length, 2);
    for (const { target, source } of f.renders) {
      assert.equal(source.position.x, 0);
      assert.equal(source.size.width, size[0]);
      close(source.size.height, size[1] * 0.28);
      assert.ok(target.width <= 2400);
      assert.ok(target.width <= size[0] * 2);
      assert.ok(target.height <= Math.ceil(source.size.height * 2));
      assert.ok(target.width * target.height <= 2000000, 'render target must stay within the two-megapixel cap');
    }
    close(f.renders[0].source.position.y, size[1] * 0.64);
    close(f.renders[1].source.position.y, size[1] * 0.20);
  }
});

test('Photos cancellation remains silent and does not invoke OCR or fallback pickers', async () => {
  for (const pick of [async () => [], async () => { throw new Error('用户取消'); }]) {
    let fallback = 0;
    const f = fixture({ photos: { pick, pickPhotos: async () => { fallback++; return []; } } });
    assert.equal((await f.recognizeFromPickedScreenshot()).reason, 'cancelled');
    assert.equal(f.calls.length, 0);
    assert.equal(fallback, 0);
    assert.deepEqual(f.effects, []);
  }
});

test('Photos compatibility fallback still recognizes only the selected image', async () => {
  let picks = 0;
  const f = fixture({ rendered: false });
  f.context.Photos = { pick: async options => {
    picks++;
    if ('filter' in options) throw new Error('unsupported filter argument');
    return [{ uiImage: async () => f.image }];
  } };
  assert.equal((await f.recognizeFromPickedScreenshot()).ok, true);
  assert.equal(picks, 2);
  assert.equal(f.calls.length, 1);
});

test('camera scanning retains text-only results and cancellation without photo access or crops', async () => {
  for (const scanDocument of [async () => ['G1234\n过 北京南', '终 上海虹桥'], async () => [], async () => { throw new Error('Cancel'); }]) {
    const f = fixture({ photos: { pick: () => assert.fail('camera must not pick photos') }, vision: { scanDocument } });
    const result = await f.recognizeFromCamera();
    if (result.ok) {
      assert.equal(result.text, 'G1234\n过 北京南\n终 上海虹桥');
      assert.deepEqual(plain(result.candidates), []);
    } else assert.equal(result.reason, 'cancelled');
    assert.equal(f.renders.length, 0);
    assert.deepEqual(f.effects, []);
  }
});

test('baseline recognition failures and missing native capabilities retain existing error results', async () => {
  const failed = fixture({ vision: { recognizeText: async () => { throw new Error('recognition unavailable'); } } });
  assert.equal((await failed.recognizeFromPickedScreenshot()).reason, 'failed');
  const empty = fixture({ text: '' });
  assert.equal((await empty.recognizeFromPickedScreenshot()).reason, 'failed');
  const missing = fixture();
  delete missing.context.Vision;
  assert.equal((await missing.recognizeFromPickedScreenshot()).reason, 'unsupported');
  assert.equal((await missing.recognizeFromCamera()).reason, 'unsupported');
});

(async () => {
  let count = 0;
  for (const [name, run] of tests) { await run(); console.log(`✓ ${++count}. ${name}`); }
  console.log(`All ${count} OCR service tests passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
