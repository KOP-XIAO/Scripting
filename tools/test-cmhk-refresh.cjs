#!/usr/bin/env node
'use strict';
// Bundles live repository sources in memory; writes no repository files.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ROOT = process.env.CMHK_REPO || path.resolve(__dirname, '../cmhk-usage');
function esbuild() {
  if (process.env.ESBUILD_MODULE) return require(process.env.ESBUILD_MODULE);
  try { return require('esbuild'); } catch {}
  for (const base of [path.join(process.env.HOME, '.npm/_npx'), '/tmp']) {
    let names = []; try { names = fs.readdirSync(base); } catch {}
    for (const name of names) for (const suffix of ['node_modules/esbuild/lib/main.js', 'esbuild/lib/main.js']) {
      const file = path.join(base, name, suffix); if (fs.existsSync(file)) return require(file);
    }
  }
  throw new Error('esbuild missing: run PATH=/opt/homebrew/opt/node/bin:$PATH npx --yes --package=esbuild esbuild --version, then retry');
}
class Clock {
  constructor() { this.now = 1700000000000; this.start = this.now; this.timers = new Map(); this.id = 0; }
  setTimeout(fn, ms = 0, ...args) { const id = ++this.id; this.timers.set(id, { at: this.now + Math.max(0, Number(ms)), fn: () => fn(...args) }); return id; }
  clearTimeout(id) { this.timers.delete(id); }
  async flush() { for (let i = 0; i < 80; i++) await Promise.resolve(); }
  async run(promise, maxMs = 20000) {
    let done = false, result, error;
    Promise.resolve(promise).then(v => { done = true; result = v; }, e => { done = true; error = e; });
    const end = this.now + maxMs;
    for (let rounds = 0; rounds < 2000; rounds++) {
      await this.flush(); if (done) { if (error) throw error; return result; }
      const next = [...this.timers.entries()].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next || next[1].at > end) throw new Error(`Promise pending at virtual ${this.now - this.start}ms; budget ${maxMs}ms, timers=${this.timers.size}`);
      this.now = next[1].at; this.timers.delete(next[0]); next[1].fn();
    }
    throw new Error('Clock did not make progress');
  }
}
const forever = () => new Promise(() => {});
const URL = 'https://www.hk.chinamobile.com/api/omni-channel-service-personal/rest/account-manager/cbs/usageQuery';
const GOOD = { code: '000000', data: { result: [{ name: '服務計劃數據', details: [{ name: 'Plan', total: '60', usage: '10', margin: '50', unit: 'GB', msisdn: '56088892' }] }] } };
const message = (url = URL, body = GOOD) => ({ url, method: 'POST', reqBody: '{}', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { cmhkChannel: 'WEB' } });
let bundled;
async function compile() {
  const built = await esbuild().build({ stdin: { contents: 'export * as cmhk from "./cmhk"; export * as web from "./web-login"; export * as timeout from "./timeout";', resolveDir: ROOT, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'warning', external: ['scripting'],
    plugins: [{ name: 'private-test-seams', setup(build) { build.onLoad({ filter: /\/(cmhk\.ts|web-login\.tsx)$/ }, args => ({ contents: fs.readFileSync(args.path, 'utf8') + (args.path.endsWith('/cmhk.ts') ? '\nexport { fetchJson, fetchDirectWithSession, fetchWithWebSession };' : '\nexport { buildFillLoginJs };'), loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts' })); } }],
  }); assert.equal(built.warnings.length, 0, 'source bundle must have no unresolved-export warnings'); bundled = built.outputFiles[0].text;
}
function fixture(options = {}) {
  const clock = new Clock(), storage = new Map(), keychain = new Map(), writes = [], views = [], requests = [];
  class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])); } static now() { return clock.now; } }
  const store = (map, kind) => ({ get: k => map.get(k) ?? null, set: (k, v) => { map.set(k, v); writes.push([kind, k, v]); return true; }, remove: k => map.delete(k) });
  class WebView {
    constructor() { this.handlers = {}; this.loads = []; this.scripts = []; this.disposed = 0; views.push(this); }
    addScriptMessageHandler(name, cb) { this.handlers[name] = cb; return options.setup ? options.setup(this, name) : Promise.resolve(); }
    emit(msg, name = 'cmhkCapture') { return this.handlers[name]?.(msg); }
    loadURL(url) { this.loads.push(url); return options.load ? options.load(this, url) : Promise.resolve(true); }
    present() { return Promise.resolve(); }
    evaluateJavaScript(js) {
      this.scripts.push(js); const kind = js.includes('__cmhkAutoSubmitted') ? 'fill' : js.includes('document.cookie') ? 'cookie' : js === 'return location.href' ? 'href' : 'hook';
      return Promise.resolve(options.evaluate ? options.evaluate(this, kind, js) : kind === 'fill' ? 'no-form' : kind === 'href' ? this.loads.at(-1) : kind === 'cookie' ? 'sid=fake' : true);
    }
    getHTML() { return Promise.resolve(''); } dispose() { this.disposed++; }
  }
  const sandbox = { module: { exports: {} }, console, Date: FakeDate, setTimeout: clock.setTimeout.bind(clock), clearTimeout: clock.clearTimeout.bind(clock), Storage: store(storage, 'storage'), Keychain: store(keychain, 'keychain'), WebViewController: WebView,
    require(name) { assert.equal(name, 'scripting'); return { fetch: (...args) => { requests.push(args); return options.fetch ? options.fetch(...args) : Promise.reject(new Error('offline')); } }; } };
  sandbox.exports = sandbox.module.exports; vm.runInNewContext(bundled, sandbox, { filename: 'cmhk-regression-bundle.cjs' });
  const api = sandbox.module.exports; api.cmhk.saveCredentials('51234567', 'test-only-password'); writes.length = 0;
  return { ...api, clock, storage, keychain, writes, views, requests, session() { api.cmhk.saveWebSession({ url: URL, method: 'POST', reqBody: '{}', pageUrl: 'https://www.hk.chinamobile.com/tc/home/my-zone/menu/usage-query', cookie: 'sid=old', authorization: null }); writes.length = 0; } };
}
const tests = []; const test = (name, fn) => tests.push([name, fn]);
function noSession(f) { assert.equal(f.cmhk.readWebSession(), null, 'must not save session'); assert.equal(f.cmhk.readCapturedBody(), null, 'must not save body'); }
function disposed(f) { assert.equal(f.views.length, 1); assert.equal(f.views[0].disposed, 1, 'dispose exactly once'); }
test('withTimeout clears timers on resolution, rejection and timeout', async () => {
  const f = fixture(); assert.equal(await f.clock.run(f.timeout.withTimeout(Promise.resolve(7), 2000, 'ok')), 7); assert.equal(f.clock.timers.size, 0);
  await assert.rejects(f.clock.run(f.timeout.withTimeout(Promise.reject(new Error('bad')), 2000, 'reject')), /bad/); assert.equal(f.clock.timers.size, 0);
  await assert.rejects(f.clock.run(f.timeout.withTimeout(forever(), 2000, 'stall')), /超时|timeout/i); assert.equal(f.clock.timers.size, 0);
});
for (const stalled of ['setup', 'hook', 'fill']) test(`autoRelogin bounds stalled native ${stalled} and disposes`, async () => {
  const f = fixture({ setup: stalled === 'setup' ? forever : undefined, evaluate: (_wv, kind) => kind === stalled ? forever() : kind === 'fill' ? 'no-form' : true });
  const result = await f.clock.run(f.web.autoRelogin(), 15100); assert.equal(result.summary, null); assert.ok(result.reason); assert.ok(f.clock.now - f.clock.start <= 15000); disposed(f); noSession(f);
  if (stalled === 'setup') assert.ok(f.clock.now - f.clock.start <= 2000);
});
for (const fill of ['no-form', 'no-button', undefined]) test(`autoRelogin exits early with last fill state ${String(fill)}`, async () => {
  const f = fixture({ evaluate: (_wv, kind) => kind === 'fill' ? fill : true }); const result = await f.clock.run(f.web.autoRelogin(), 8500);
  assert.equal(result.summary, null); assert.ok(result.reason); assert.match(result.reason, fill === 'no-form' ? /no-form|未找到登录表单/ : fill === 'no-button' ? /no-button|未找到登录按钮/ : /undefined|未知|未返回|无返回|無返回/);
  assert.ok(f.clock.now - f.clock.start <= 8000, '6s no-submit budget plus one native step'); disposed(f); noSession(f);
});
test('fill JavaScript returns DOM outcomes and submits credentials once', async () => {
  const f = fixture(), js = f.web.buildFillLoginJs('51234567', 'p"\\word'); let clicks = 0; const events = [];
  const input = (type, placeholder) => ({ type, placeholder, offsetParent: {}, getAttribute: () => '', focus() {}, blur() {}, dispatchEvent: e => events.push(e.type), value: '' });
  const phone = input('tel', '手機號碼'), password = input('password', '密碼'); let inputs = [], caps = [], buttons = []; const window = {};
  const context = { window, Event: class { constructor(type) { this.type = type; } }, document: { querySelectorAll: s => s === 'input' ? inputs : s.startsWith('img') ? caps : buttons } };
  const run = () => vm.runInNewContext(`(function(){${js}\n})()`, context);
  assert.equal(run(), 'no-form'); inputs = [phone, password]; caps = [{ offsetParent: {} }]; assert.equal(run(), 'captcha'); caps = []; assert.equal(run(), 'no-button');
  buttons = [{ offsetParent: {}, textContent: '登入', click() { clicks++; } }]; assert.equal(run(), 'clicked'); assert.equal(phone.value, '51234567'); assert.equal(password.value, 'p"\\word');
  assert.deepEqual(events.slice(-4), ['input', 'change', 'input', 'change']); assert.equal(run(), 'already-submitted'); assert.equal(clicks, 1);
});
test('valid cbs capture persists session, body and headers', async () => {
  const f = fixture({ evaluate: (wv, kind) => { if (kind === 'hook') wv.emit(message()); return kind === 'cookie' ? 'sid=new' : true; } });
  const r = await f.clock.run(f.web.autoRelogin()); assert.equal(r.summary.data.result[0].details[0].margin, '50'); assert.equal(f.cmhk.readWebSession().url, URL); assert.equal(f.cmhk.readWebSession().headers.cmhkChannel, 'WEB'); assert.equal(JSON.parse(f.cmhk.readCapturedBody()).code, '000000'); disposed(f);
});
test('cookie read stall is bounded and view disposed', async () => {
  const f = fixture({ evaluate: (wv, kind) => { if (kind === 'hook') wv.emit(message()); return kind === 'cookie' ? forever() : true; } });
  const r = await f.clock.run(f.web.autoRelogin(), 15100); assert.ok(f.clock.now - f.clock.start <= 15000); assert.ok(r.summary || r.reason); disposed(f);
});
for (const [label, capture] of [['business error', message(URL, { code: '999999', message: '用戶未登錄' })], ['malformed JSON', message(URL, '{broken')], ['empty usage', message(URL, { code: '000000', data: {} })], ['other endpoint', message('/rest/account-manager/indexUsageQuery', GOOD)]]) test(`rejects ${label} capture without saving`, async () => {
  const f = fixture({ evaluate: (wv, kind) => { if (kind === 'hook') wv.emit(capture); return kind === 'fill' ? 'no-form' : true; } });
  assert.equal((await f.clock.run(f.web.autoRelogin(), 15100)).summary, null); noSession(f); disposed(f); assert.equal(f.cmhk.readCaptures().length, 0, 'invalid response must not enter capture ring');
});
test('accountLogin rejection aborts without saving usage', async () => {
  const f = fixture({ evaluate: (wv, kind) => { if (kind === 'hook') wv.emit(message('/rest/single/accountLogin', { code: '100001', message: 'incorrect password' })); return kind === 'fill' ? 'clicked' : true; } });
  const r = await f.clock.run(f.web.autoRelogin()); assert.equal(r.summary, null); assert.match(r.reason, /拒|密码|密碼|100001/); noSession(f); disposed(f); assert.equal(f.cmhk.readCaptures().length, 0);
});
test('callbacks after autoRelogin disposal do not mutate persistence', async () => {
  const f = fixture({ setup: forever }); await f.clock.run(f.web.autoRelogin()); disposed(f); const before = JSON.stringify([...f.storage]), writes = f.writes.length;
  f.views[0].emit(message()); f.views[0].emit(message('/rest/single/accountLogin', { code: '999999' })); assert.equal(f.writes.length, writes); assert.equal(JSON.stringify([...f.storage]), before); noSession(f);
});
test('login signal navigates to usage even with usage initial URL', async () => {
  let fills = 0, signals = 0; const f = fixture({ evaluate: (wv, kind) => {
    if (kind === 'fill') { fills++; return 'clicked'; }
    if (kind === 'hook' && fills && !signals++) wv.emit(message('/rest/single/queryLoginInfo', { code: '000000' }));
    if (kind === 'hook' && wv.loads.length >= 2) wv.emit(message()); return kind === 'cookie' ? 'sid=new' : true;
  } });
  const r = await f.clock.run(f.web.autoRelogin(), 15100); assert.ok(r.summary); assert.ok(f.views[0].loads.length >= 2); assert.equal(fills, 1); disposed(f);
});
test('fetchJson deadline includes body parsing', async () => {
  const f = fixture({ fetch: async () => ({ ok: true, json: forever }) }); await assert.rejects(f.clock.run(f.cmhk.fetchJson('https://example.invalid', {}, 1200), 1300), /超时|timeout/i); assert.equal(f.clock.now - f.clock.start, 1200); assert.equal(f.clock.timers.size, 0);
});
test('direct deadline includes body parsing', async () => {
  const f = fixture({ fetch: async () => ({ ok: true, json: forever }) }); f.session(); const r = await f.clock.run(f.cmhk.fetchDirectWithSession(f.cmhk.readWebSession()).catch(e => e), 3100);
  assert.ok(r === null || /超时|timeout/i.test(String(r))); assert.equal(f.clock.now - f.clock.start, 3000);
});
test('page capture setup stalls at most 2s and disposes', async () => {
  const f = fixture({ setup: forever }); f.session(); await assert.rejects(f.clock.run(f.cmhk.fetchWithWebSession(), 2100), /超时|timeout/i); disposed(f); assert.equal(f.clock.now - f.clock.start, 2000);
  const writes = f.writes.length; f.views[0].emit(message(), 'cmhkReplay'); assert.equal(f.writes.length, writes);
});
for (const mode of ['failure', 'hung JSON']) test(`refresh dedupes and releases after ${mode}`, async () => {
  let calls = 0; const f = fixture({ fetch: async () => { calls++; if (mode === 'failure') throw new Error('offline'); return { ok: true, json: forever }; } }); f.cmhk.saveManualEndpoint('https://example.invalid/usage', '{}');
  const results = await f.clock.run(Promise.allSettled([f.cmhk.refreshUsage(), f.cmhk.refreshUsage()]), 12100); assert.equal(calls, 1); assert.equal(results[0].status, results[1].status);
  await f.clock.run(f.cmhk.refreshUsage().catch(() => null), 12100); assert.equal(calls, 2, 'failure releases in-flight latch'); assert.equal(f.clock.timers.size, 0);
});
test('full refresh releases dedupe with direct JSON and page setup hung', async () => {
  const f = fixture({ setup: forever, fetch: async () => ({ ok: true, json: forever }) }); f.session();
  const r = await f.clock.run(Promise.allSettled([f.cmhk.refreshUsage(), f.cmhk.refreshUsage()]), 3200); assert.equal(f.requests.length, 1); assert.equal(f.views.length, 1); assert.equal(f.views[0].disposed, 1); assert.equal(r[0].status, r[1].status);
  await f.clock.run(f.cmhk.refreshUsage().catch(() => null), 3200); assert.equal(f.requests.length, 2); assert.equal(f.views.length, 2); assert.equal(f.views[1].disposed, 1);
});
test('rejected login takes precedence over a simultaneous valid usage capture', async () => {
  const f = fixture({ evaluate: (wv, kind) => { if (kind === 'hook') { wv.emit(message()); wv.emit(message('/rest/single/accountLogin', { code: '999999', message: 'denied' })); } return true; } });
  const r = await f.clock.run(f.web.autoRelogin()); assert.equal(r.summary, null); noSession(f); disposed(f);
});
test('late successful capture after cookie timeout cannot overwrite prior session', async () => {
  const f = fixture({ evaluate: (wv, kind) => { if (kind === 'hook') wv.emit(message()); return kind === 'cookie' ? forever() : true; } }); f.session();
  const old = JSON.stringify(f.cmhk.readWebSession()); const r = await f.clock.run(f.web.autoRelogin(), 2100);
  assert.equal(r.summary, null); assert.equal(f.clock.now - f.clock.start, 2000); disposed(f);
  const writes = f.writes.length; f.views[0].emit(message()); assert.equal(f.writes.length, writes); assert.equal(JSON.stringify(f.cmhk.readWebSession()), old); assert.equal(f.cmhk.readCapturedBody(), null);
});
test('submitted login has a 15s total budget and only submits once', async () => {
  let fills = 0;
  const f = fixture({ load: forever, evaluate: (_wv, kind) => { if (kind === 'fill') { fills++; return 'clicked'; } return true; } });
  const r = await f.clock.run(f.web.autoRelogin(), 15000);
  assert.equal(r.summary, null); assert.ok(r.reason); assert.equal(fills, 1); assert.ok(f.clock.now - f.clock.start <= 15000); disposed(f); noSession(f); assert.equal(f.clock.timers.size, 0);
});
test('successful fetchJson and direct requests clear deadline timers', async () => {
  const f = fixture({ fetch: async () => ({ ok: true, json: async () => GOOD }) }); f.session();
  assert.equal((await f.clock.run(f.cmhk.fetchJson('https://example.invalid', {}, 1200))).code, '000000'); assert.equal(f.clock.timers.size, 0);
  assert.equal((await f.clock.run(f.cmhk.fetchDirectWithSession(f.cmhk.readWebSession()))).code, '000000'); assert.equal(f.clock.timers.size, 0);
});
test('expired refresh returns relogin reason, releases latch and respects cooldown', async () => {
  const f = fixture({ fetch: async () => ({ ok: true, json: async () => ({ code: '000005', message: '尚未登錄' }) }), evaluate: (_wv, kind) => kind === 'href' ? 'https://example.invalid/login' : kind === 'fill' ? 'no-form' : true });
  f.session(); f.cmhk.saveCapturedBody(JSON.stringify(GOOD)); f.cmhk.setAutoReloginHandler(f.web.autoRelogin);
  const r = await f.clock.run(f.cmhk.refreshUsage(), 18000);
  assert.equal(r.stale, true); assert.match(f.cmhk.readRefreshReport().path, /自动重登未完成.*未找到登录表单/);
  assert.equal(f.views.length, 2); assert.ok(f.views.every(w => w.disposed === 1));
  await f.clock.run(f.cmhk.refreshUsage(), 5000);
  assert.equal(f.views.length, 3, 'cooldown skips a second automatic login view');
  assert.match(f.cmhk.readRefreshReport().path, /冷却中/);
});
for (const outcome of ['null', 'error', 'stale', 'success']) test(`manual refresh ${outcome} ends busy with a visible terminal status`, async () => {
  const source = fs.readFileSync(path.join(ROOT, 'index.tsx'), 'utf8');
  const start = source.indexOf('  async function handleRefresh(opts?');
  const end = source.indexOf('  // 静默自动刷新', start);
  assert.ok(start >= 0 && end > start);
  const code = esbuild().transformSync('globalThis.handler = ' + source.slice(start, end).trim(), { loader: 'ts' }).code;
  let busy = false; const statuses = []; const report = { ok: outcome === 'success', changed: true, path: '自动重登未完成（未找到登录表单）' };
  const sandbox = { setBusy: v => { busy = v; }, setStatus: v => statuses.push(v), setData() {}, Widget: { reloadUserWidgets() {} }, readRefreshReport: () => report, friendlyError: e => e.message,
    refreshUsage: async () => { if (outcome === 'error') throw new Error('test network error'); return outcome === 'null' ? null : { stale: outcome === 'stale' }; },
    Dialog: { confirm() { throw new Error('refresh must release busy without waiting for a dialog'); } }, handleWebLogin() { throw new Error('login must remain a separate action'); } };
  vm.runInNewContext(code, sandbox); await sandbox.handler();
  assert.equal(busy, false); assert.ok(statuses[0]); assert.ok(statuses.at(-1));
  assert.match(statuses.at(-1), outcome === 'success' ? /已刷新/ : /未取得|失败/);
  if (outcome === 'stale') assert.match(statuses.at(-1), /未找到登录表单/);
});
(async () => { await compile(); let failed = 0; for (const [name, fn] of tests) { try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n${e.stack || e}`); } } console.log(`\n${tests.length - failed}/${tests.length} passed against ${ROOT}`); process.exitCode = failed ? 1 : 0; })().catch(e => { console.error(e); process.exitCode = 1; });
