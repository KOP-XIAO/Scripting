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
const GOOD = { code: '000000', data: { result: [{ name: '服務計劃數據', details: [{ name: 'Plan', total: '60', usage: '10', margin: '50', unit: 'GB', msisdn: '51234567' }] }] } };
const message = (url = URL, body = GOOD) => ({ url, method: 'POST', reqBody: '{}', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { cmhkChannel: 'WEB' } });
let bundled;
async function compile() {
  const built = await esbuild().build({ stdin: { contents: 'export * as cmhk from "./cmhk"; export * as web from "./web-login"; export * as timeout from "./timeout";', resolveDir: ROOT, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'warning', external: ['scripting'],
    plugins: [{ name: 'private-test-seams', setup(build) { build.onLoad({ filter: /\/(cmhk\.ts|web-login\.tsx)$/ }, args => ({ contents: fs.readFileSync(args.path, 'utf8') + (args.path.endsWith('/cmhk.ts') ? '\nexport { fetchJson, fetchDirectWithSession, fetchWithWebSession, CAPTURE_HOOK_JS };' : '\nexport { buildFillLoginJs, INJECT_HOOK };'), loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts' })); } }],
  }); assert.equal(built.warnings.length, 0, 'source bundle must have no unresolved-export warnings'); bundled = built.outputFiles[0].text;
}
function fixture(options = {}) {
  const clock = new Clock(), storage = new Map(), keychain = new Map(), writes = [], views = [], requests = [];
  class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])); } static now() { return clock.now; } }
  const store = (map, kind) => ({ get: k => map.get(k) ?? null, set: (k, v) => { map.set(k, v); writes.push([kind, k, v]); return true; }, remove: k => map.delete(k) });
  class WebView {
    constructor(controllerOptions) { this.options = controllerOptions; this.handlers = {}; this.loads = []; this.scripts = []; this.disposed = 0; if (options.cookies) this.getCookies = (...args) => options.cookies(this, ...args); views.push(this); }
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
function loginDom(f, overrides = {}) {
  const events = [], window = {}; let clicks = 0;
  const element = (props = {}) => ({ tagName: 'INPUT', type: 'text', placeholder: '', name: '', id: '', value: '', offsetParent: {}, disabled: false, checked: true,
    getAttribute(k) { return this.attributes?.[k] ?? this[k] ?? null; }, hasAttribute(k) { return this.attributes?.[k] != null || this[k] === true; }, getClientRects() { return this.offsetParent == null ? [] : [{}]; },
    focus() {}, blur() {}, dispatchEvent(e) { events.push(e.type); }, closest(selector) { return selector.includes('tab') && this.tab ? this : null; }, click() { clicks++; }, ...props });
  const phone = element({ type: 'tel', placeholder: '手機號碼' }), pwd = element({ type: 'password', placeholder: '密碼' });
  const button = element({ tagName: 'BUTTON', type: 'submit', textContent: '登入' });
  const state = { inputs: [phone, pwd], caps: [], buttons: [button], location: { origin: 'https://www.hk.chinamobile.com', protocol: 'https:', hostname: 'www.hk.chinamobile.com', href: 'https://www.hk.chinamobile.com/tc/login' }, ...overrides };
  const query = selector => {
    if (selector === 'input') return state.inputs;
    if (/captcha|verify|vcode|驗證碼|验证码/.test(selector)) return state.caps;
    if (/checkbox/.test(selector)) return state.inputs.filter(e => e.type === 'checkbox');
    if (/input/.test(selector) && !/button|role|submit|tab|\ba\b/.test(selector)) return state.inputs;
    return state.buttons;
  };
  const context = { window, location: state.location, HTMLInputElement: class {}, Event: class { constructor(type) { this.type = type; } }, document: { querySelectorAll: query, querySelector: s => query(s)[0] ?? null } };
  const js = f.web.buildFillLoginJs('51234567', 'p"\\word');
  return { state, phone, pwd, button, element, events, get clicks() { return clicks; }, run: () => vm.runInNewContext(`(function(){${js}\n})()`, context) };
}
test('fill JavaScript returns DOM outcomes and submits credentials once', async () => {
  const f = fixture(), d = loginDom(f, { inputs: [] });
  assert.equal(d.run(), 'no-form'); d.state.inputs = [d.phone, d.pwd]; d.state.caps = [d.element()]; assert.equal(d.run(), 'captcha'); d.state.caps = [];
  assert.equal(d.run(), 'filled'); assert.equal(d.phone.value, '51234567'); assert.equal(d.pwd.value, 'p"\\word'); assert.equal(d.clicks, 0);
  assert.equal(d.run(), 'clicked'); assert.equal(d.run(), 'already-submitted'); assert.equal(d.clicks, 1);
  assert.deepEqual(d.events.slice(-4), ['input', 'change', 'input', 'change']);
});
test('valid cbs capture persists session, body and headers', async () => {
  const f = fixture({ evaluate: (wv, kind) => { if (kind === 'hook') wv.emit(message()); return kind === 'cookie' ? 'sid=new' : true; } });
  const r = await f.clock.run(f.web.autoRelogin()); assert.equal(r.summary.data.result[0].details[0].margin, '50'); assert.equal(f.cmhk.readWebSession().url, URL); assert.equal(f.cmhk.readWebSession().headers.cmhkChannel, 'WEB'); assert.equal(JSON.parse(f.cmhk.readCapturedBody()).code, '000000'); disposed(f);
  const report = f.web.readAutoLoginReport(); assert.equal(report.fresh, false); assert.equal(report.submitted, false); assert.equal(report.loginConfirmed, false); assert.equal(report.usageCaptured, true);
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
    if (kind === 'hook' && fills && !signals++) { wv.emit(message('/rest/single/accountLogin', { code: '000000' })); wv.emit(message('/rest/single/queryLoginInfo', { code: '000000' })); }
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
const LOGIN = '/api/omni-channel-service-common/rest/single/';
function authenticate(wv, { endpoint = 'accountLogin', confirm = 'successLogin', whitespace = false, includeUsage = true } = {}) {
  const success = { code: '000000', message: 'success', data: { token: 'never-report-token' } };
  const body = whitespace ? JSON.stringify(success, null, 2) : success;
  wv.emit(message(LOGIN + endpoint, body));
  wv.emit(message(LOGIN + confirm, body));
  if (includeUsage) wv.emit(message());
}
function seedHistorical(f) {
  const old = structuredClone(GOOD); old.data.result[0].details[0].margin = '1';
  f.cmhk.saveCapture(URL, JSON.stringify(old)); f.cmhk.saveCapturedBody(JSON.stringify(old));
  f.storage.set('cmhk.usage.cache', { ...f.cmhk.demoData(), dataRemainingGB: 1 });
  return JSON.stringify(f.cmhk.readCache());
}
function assertSanitizedReport(report) {
  assert.ok(report && typeof report.stage === 'string');
  const allowed = new Set(['startedAt', 'finishedAt', 'fresh', 'stage', 'submitted', 'loginConfirmed', 'usageCaptured', 'reason', 'cookieSource', 'hookInstalled', 'form']);
  for (const key of Object.keys(report)) assert.ok(allowed.has(key), `unexpected report field ${key}`);
  if (report.hookInstalled != null) assert.equal(typeof report.hookInstalled, 'boolean');
  if (report.form != null) {
    assert.deepEqual(Object.keys(report.form).sort(), ['inputCount', 'passwordCount', 'visiblePasswordCount'].sort());
    for (const value of Object.values(report.form)) assert.ok(Number.isInteger(value) && value >= 0, 'form diagnostic must be a nonnegative count');
  }
  const json = JSON.stringify(report);
  for (const secret of ['51234567', 'test-only-', 'sid=fake', 'sid=new', 'never-report-token']) assert.ok(!json.includes(secret), `report leaked ${secret}`);
}
test('normal no-session refresh bootstraps automatic login before historical captures', async () => {
  const f = fixture(); seedHistorical(f); let calls = 0;
  f.cmhk.setAutoReloginHandler(async () => { calls++; return { summary: GOOD }; });
  const result = await f.clock.run(f.cmhk.refreshUsage());
  assert.equal(calls, 1); assert.equal(result.dataRemainingGB, 50); assert.notEqual(result.stale, true); assert.equal(f.requests.length, 0);
  assert.match(f.cmhk.readRefreshReport().path, /自动登录|自动重登/);
});
test('directOnly without a session never starts automatic login', async () => {
  const f = fixture(); let calls = 0; f.cmhk.setAutoReloginHandler(async () => { calls++; return { summary: GOOD }; });
  assert.equal(await f.clock.run(f.cmhk.refreshUsage({ directOnly: true })), null); assert.equal(calls, 0); assert.equal(f.views.length, 0);
});
test('explicit verification ignores manual endpoint, fresh snapshot and cache', async () => {
  const f = fixture(); seedHistorical(f); f.session(); f.cmhk.saveManualEndpoint('https://example.invalid/manual', '{}'); let calls = 0;
  f.cmhk.setAutoReloginHandler(async opts => { calls++; assert.equal(opts?.fresh, true); return { summary: GOOD }; });
  const result = await f.clock.run(f.cmhk.refreshUsage({ autoLoginOnly: true, snapshotFirst: true }));
  assert.equal(calls, 1); assert.equal(result.dataRemainingGB, 50); assert.equal(f.requests.length, 0); assert.match(f.cmhk.readRefreshReport().path, /自动登录验证/);
});
for (const response of [null, { code: '999999', message: '未登录' }, { code: '000000', data: {} }]) test(`explicit failed verification cannot fall back to cached usage (${JSON.stringify(response)})`, async () => {
  const f = fixture(), before = seedHistorical(f); f.cmhk.saveManualEndpoint('https://example.invalid/manual', '{}');
  f.cmhk.setAutoReloginHandler(async opts => { assert.equal(opts?.fresh, true); return { summary: response, reason: 'test rejected login' }; });
  await assert.rejects(f.clock.run(f.cmhk.refreshUsage({ autoLoginOnly: true, snapshotFirst: true })), /验证|登录|未完成/);
  assert.equal(JSON.stringify(f.cmhk.readCache()), before); assert.equal(f.cmhk.readRefreshReport().ok, false); assert.equal(f.requests.length, 0);
});
test('demo mode rejects explicit login verification without returning demo success', async () => {
  const f = fixture(), before = seedHistorical(f); f.cmhk.setDemoMode(true); let calls = 0;
  f.cmhk.setAutoReloginHandler(async () => { calls++; return { summary: GOOD }; });
  await assert.rejects(f.clock.run(f.cmhk.refreshUsage({ autoLoginOnly: true })), /演示/);
  assert.equal(calls, 0); assert.equal(JSON.stringify(f.cmhk.readCache()), before); assert.equal(f.cmhk.isDemoMode(), true);
});
test('explicit verification waits for ordinary refresh then runs its own fresh login', async () => {
  let release; const f = fixture({ fetch: () => new Promise(resolve => { release = resolve; }) }); f.cmhk.saveManualEndpoint('https://example.invalid/manual', '{}');
  let calls = 0; f.cmhk.setAutoReloginHandler(async opts => { calls++; assert.equal(opts?.fresh, true); return { summary: GOOD }; });
  const ordinary = f.cmhk.refreshUsage(); await f.clock.flush();
  const verification = f.cmhk.refreshUsage({ autoLoginOnly: true }); await f.clock.flush(); assert.equal(calls, 0);
  const old = structuredClone(GOOD); old.data.result[0].details[0].margin = '3'; release({ ok: true, json: async () => old });
  const [a, b] = await f.clock.run(Promise.all([ordinary, verification])); assert.equal(a.dataRemainingGB, 3); assert.equal(b.dataRemainingGB, 50); assert.equal(calls, 1);
});
test('deliberate sequential verifications each run fresh despite normal cooldown', async () => {
  const f = fixture(); let calls = 0; f.cmhk.setAutoReloginHandler(async opts => { calls++; assert.equal(opts?.fresh, true); return { summary: GOOD }; });
  await f.clock.run(f.cmhk.refreshUsage({ autoLoginOnly: true })); await f.clock.run(f.cmhk.refreshUsage({ autoLoginOnly: true })); assert.equal(calls, 2);
});
for (const mode of ['only usage', 'confirmation without auth', 'auth without confirmation', 'usage before confirmation']) test(`fresh isolated WebView refuses ${mode}`, async () => {
  let sent = false; const f = fixture({ evaluate: (wv, kind) => {
    if (kind === 'hook' && !sent) {
      sent = true;
      if (mode === 'usage before confirmation') wv.emit(message());
      if (mode === 'auth without confirmation' || mode === 'usage before confirmation') wv.emit(message(LOGIN + 'accountLogin', { code: '000000' }));
      if (mode === 'confirmation without auth' || mode === 'usage before confirmation') wv.emit(message(LOGIN + 'queryLoginInfo', { code: '000000' }));
      if (mode !== 'usage before confirmation') wv.emit(message());
    }
    return kind === 'fill' ? 'clicked' : true;
  } });
  const result = await f.clock.run(f.web.autoRelogin({ fresh: true }), 15000);
  assert.equal(result.summary, null); assert.equal(f.views[0].options?.ephemeral, true); disposed(f); noSession(f);
  const report = f.web.readAutoLoginReport(); assert.equal(report.fresh, true); assert.equal(report.usageCaptured, false); assertSanitizedReport(report);
});
for (const endpoint of ['accountLogin', 'oneClickLogin']) test(`fresh login requires observed ${endpoint} acceptance, confirmation and subsequent usage`, async () => {
  let sent = false; const f = fixture({ evaluate: (wv, kind) => { if (kind === 'hook' && !sent) { sent = true; authenticate(wv, { endpoint, whitespace: true }); } return kind === 'cookie' ? 'sid=new' : true; } });
  const result = await f.clock.run(f.web.autoRelogin({ fresh: true })); assert.ok(result.summary); assert.equal(f.views[0].options?.ephemeral, true); disposed(f);
  const report = f.web.readAutoLoginReport(); assert.equal(report.submitted, true); assert.equal(report.loginConfirmed, true); assert.equal(report.usageCaptured, true); assert.equal(report.fresh, true); assert.equal(typeof report.finishedAt, 'number'); assertSanitizedReport(report);
});
test('clicking alone never reports a submitted login request', async () => {
  const f = fixture({ evaluate: (_wv, kind) => kind === 'fill' ? 'clicked' : true });
  assert.equal((await f.clock.run(f.web.autoRelogin({ fresh: true }), 15000)).summary, null);
  const report = f.web.readAutoLoginReport(); assert.equal(report.submitted, false); assert.equal(report.loginConfirmed, false); assert.equal(report.usageCaptured, false); assert.match(report.reason, /未观察|未觀察|请求/); assertSanitizedReport(report);
});
test('observed login request is reported even without a usable response', async () => {
  let sent = false; const f = fixture({ evaluate: (wv, kind) => { if (kind === 'hook' && !sent) { sent = true; wv.emit(message(LOGIN + 'accountLogin', '')); } return kind === 'fill' ? 'clicked' : true; } });
  await f.clock.run(f.web.autoRelogin({ fresh: true }), 15000); const report = f.web.readAutoLoginReport(); assert.equal(report.submitted, true); assert.equal(report.loginConfirmed, false); assertSanitizedReport(report);
});
test('automatic login reports progress and terminal sanitized failure', async () => {
  let f; const stages = []; f = fixture({ evaluate: (_wv, kind) => { const r = f.web.readAutoLoginReport(); if (r) { stages.push(r.stage); assertSanitizedReport(r); } return kind === 'fill' ? 'no-form' : true; } });
  await f.clock.run(f.web.autoRelogin({ fresh: true })); const report = f.web.readAutoLoginReport();
  assert.ok(stages.length > 1); assert.ok(new Set(stages).size >= 2); assert.equal(typeof report.finishedAt, 'number'); assert.ok(report.finishedAt >= report.startedAt); assert.ok(report.reason); assertSanitizedReport(report);
});
test('missing credentials produces a finished failure report without opening WebView', async () => {
  const f = fixture(); f.cmhk.clearCredentials(); assert.equal((await f.clock.run(f.web.autoRelogin({ fresh: true }))).summary, null);
  const report = f.web.readAutoLoginReport(); assert.equal(typeof report.finishedAt, 'number'); assert.ok(report.reason); assert.equal(f.views.length, 0); assertSanitizedReport(report);
});
test('server rejection report does not include response tokens or credentials', async () => {
  const f = fixture({ evaluate: (wv, kind) => { if (kind === 'hook') wv.emit(message(LOGIN + 'accountLogin', { code: '999999', message: 'rejected', data: { token: 'never-report-token', phone: '51234567' } })); return true; } });
  const result = await f.clock.run(f.web.autoRelogin({ fresh: true })); assert.equal(result.summary, null); assertSanitizedReport(f.web.readAutoLoginReport());
});
test('native cookie source is reported without leaking cookie values', async () => {
  const f = fixture({ cookies: async () => [{ name: 'sid', value: 'native-secret', domain: '.hk.chinamobile.com', path: '/', httpOnly: true }], evaluate: (wv, kind) => { if (kind === 'hook') authenticate(wv); return true; } });
  assert.ok((await f.clock.run(f.web.autoRelogin({ fresh: true }))).summary); assert.match(f.cmhk.readWebSession().cookie, /sid=native-secret/);
  const report = f.web.readAutoLoginReport(); assert.equal(report.cookieSource, 'native'); assert.ok(!JSON.stringify(report).includes('native-secret')); assertSanitizedReport(report);
});
test('document-cookie fallback remains usable and reports its source', async () => {
  const f = fixture({ evaluate: (wv, kind) => { if (kind === 'hook') authenticate(wv); return kind === 'cookie' ? 'sid=new' : true; } });
  assert.ok((await f.clock.run(f.web.autoRelogin({ fresh: true }))).summary); assert.equal(f.web.readAutoLoginReport().cookieSource, 'document'); assertSanitizedReport(f.web.readAutoLoginReport());
});
test('fill helper switches password mode once without submitting a mode tab', async () => {
  const d = loginDom(fixture(), { inputs: [] }); d.state.buttons = [d.element({ tagName: 'BUTTON', type: 'button', textContent: '密碼登入', attributes: { role: 'tab' } })];
  assert.equal(d.run(), 'switching-mode'); assert.equal(d.clicks, 1); assert.equal(d.run(), 'no-form'); assert.equal(d.clicks, 1);
});
test('fill helper waits for enabled submit and excludes login tabs', async () => {
  const d = loginDom(fixture()); const tab = d.element({ tagName: 'BUTTON', textContent: '登入', attributes: { role: 'tab' } });
  d.button.disabled = true; d.state.buttons = [tab, d.button]; assert.equal(d.run(), 'filled'); assert.equal(d.run(), 'waiting-enabled'); assert.equal(d.clicks, 0);
  d.button.disabled = false; assert.equal(d.run(), 'clicked'); assert.equal(d.clicks, 1);
});
test('fill helper rejects non-official origins without writing credentials', async () => {
  const d = loginDom(fixture(), { location: { href: 'https://hk.chinamobile.com.evil.invalid/login' } });
  assert.equal(d.run(), 'untrusted-page'); assert.equal(d.phone.value, ''); assert.equal(d.pwd.value, ''); assert.equal(d.clicks, 0);
});
test('fill helper does not accept required terms for the user', async () => {
  const d = loginDom(fixture()); const checkbox = d.element({ type: 'checkbox', required: true, checked: false }); d.state.inputs.push(checkbox);
  assert.equal(d.run(), 'terms-required'); assert.equal(checkbox.checked, false); assert.equal(d.clicks, 0); assert.equal(d.phone.value, '');
});
for (const hookName of ['login', 'replay']) test(`${hookName} capture hook handles tuple, Headers-like and object headers without losing response`, async () => {
  const f = fixture(), captures = [];
  class XHR { open() {} send() {} setRequestHeader() {} addEventListener() {} }
  const window = { fetch: async () => ({ clone: () => ({ text: async () => JSON.stringify(GOOD) }) }), webkit: { messageHandlers: { cmhkCapture: { postMessage: v => captures.push(v) }, cmhkReplay: { postMessage: v => captures.push(v) } } } };
  vm.runInNewContext(`(function(){${hookName === 'login' ? f.web.INJECT_HOOK : f.cmhk.CAPTURE_HOOK_JS}\n})()`, { window, XMLHttpRequest: XHR, document: { addEventListener() {} } });
  for (const headers of [[['cmhkChannel', 'WEB']], { forEach(fn) { fn('WEB', 'cmhkChannel'); } }, { cmhkChannel: 'WEB' }]) {
    await window.fetch(URL, { method: 'POST', body: '{}', headers }); await f.clock.flush();
    assert.equal(captures.at(-1)?.url, URL); assert.equal(JSON.parse(captures.at(-1).body).code, '000000');
    if (hookName === 'login') { assert.equal(captures.at(-1).headers.cmhkChannel, 'WEB'); assert.ok(!('0' in captures.at(-1).headers)); }
  }
});
test('login hook preserves real Request method, body, headers and pre-response submission evidence', async () => {
  const f = fixture(), captures = []; let resolveResponse;
  class XHR { open() {} send() {} setRequestHeader() {} addEventListener() {} }
  const window = { fetch: () => new Promise(resolve => { resolveResponse = resolve; }), webkit: { messageHandlers: { cmhkCapture: { postMessage: v => captures.push(v) } } } };
  vm.runInNewContext(`(function(){${f.web.INJECT_HOOK}\n})()`, { window, XMLHttpRequest: XHR, document: { addEventListener() {} } });
  const reqBody = JSON.stringify({ userName: 'synthetic-user', credential: 'synthetic-input' });
  const request = new Request('https://www.hk.chinamobile.com' + LOGIN + 'accountLogin', { method: 'POST', headers: { cmhkChannel: 'WEB' }, body: reqBody });
  const pending = window.fetch(request);
  for (let i = 0; i < 4 && captures.length === 0; i++) await new Promise(setImmediate);
  await f.clock.flush();
  assert.ok(captures.length > 0, 'submission must be observed before response completion');
  assert.equal(captures[0].method, 'POST'); assert.equal(captures[0].reqBody, ''); assert.equal(captures[0].headers.cmhkchannel, 'WEB'); assert.equal(captures[0].body, '');
  resolveResponse({ clone: () => ({ text: async () => JSON.stringify({ code: '000000' }) }) });
  await pending; await f.clock.flush(); assert.equal(captures.at(-1).method, 'POST'); assert.equal(captures.at(-1).reqBody, reqBody); assert.equal(JSON.parse(captures.at(-1).body).code, '000000');
});
for (const outcome of ['success', 'null', 'stale', 'failed report', 'error', 'missing credentials']) test(`explicit verify UI ${outcome} only declares authenticated success and always finishes`, async () => {
  const source = fs.readFileSync(path.join(ROOT, 'index.tsx'), 'utf8'), start = source.indexOf('  async function handleVerifyAutoLogin()'), end = source.indexOf('  // 打开页面', start);
  assert.ok(start >= 0 && end > start);
  const code = esbuild().transformSync('globalThis.handler = ' + source.slice(start, end).trim(), { loader: 'ts' }).code;
  const statuses = []; let calls = 0, reloads = 0;
  const sandbox = { busy: false, isWebLoginBusy: () => false, hasCredentials: () => outcome !== 'missing credentials', setBusy(v) { sandbox.busy = v; }, setStatus: v => statuses.push(v),
    setData() {}, setWebSession() {}, hasWebSession: () => true, Widget: { reloadUserWidgets() { reloads++; } }, readRefreshReport: () => ({ ok: outcome !== 'failed report' }), friendlyError: e => e.message,
    refreshUsage: async opts => { calls++; assert.equal(opts.autoLoginOnly, true); if (outcome === 'error') throw new Error('test login rejected'); return outcome === 'null' ? null : { stale: outcome === 'stale' }; } };
  vm.runInNewContext(code, sandbox); await sandbox.handler(); assert.equal(sandbox.busy, false); assert.ok(statuses.at(-1));
  if (outcome === 'success') { assert.match(statuses.at(-1), /验证成功/); assert.equal(reloads, 1); }
  else { assert.doesNotMatch(statuses.at(-1), /验证成功/); assert.match(statuses.at(-1), outcome === 'missing credentials' ? /保存.*手机|保存.*手機/ : /未完成|失败/); assert.equal(reloads, 0); }
  assert.equal(calls, outcome === 'missing credentials' ? 0 : 1);
});
test('form diagnostics retain only bounded counts and discard raw fields', async () => {
  let sent = false; const f = fixture({ evaluate: (wv, kind) => { if (kind === 'hook' && !sent) { sent = true; wv.emit({ kind: 'loginForm', inputCount: 4, passwordCount: 'never-report-token', visiblePasswordCount: -1, phone: '51234567', raw: 'test-only-credential' }); } return kind === 'fill' ? 'no-form' : true; } });
  await f.clock.run(f.web.autoRelogin({ fresh: true })); const report = f.web.readAutoLoginReport(); assert.equal(report.form.inputCount, 4); assert.equal(report.form.passwordCount, 0); assert.equal(report.form.visiblePasswordCount, 0); assertSanitizedReport(report);
});
test('fresh verification rejects otherwise valid authentication and usage from untrusted origins', async () => {
  let sent = false; const f = fixture({ evaluate: (wv, kind) => { if (kind === 'hook' && !sent) { sent = true; wv.emit(message('https://evil.invalid' + LOGIN + 'accountLogin', { code: '000000' })); wv.emit(message('https://evil.invalid' + LOGIN + 'successLogin', { code: '000000' })); wv.emit(message('https://evil.invalid/cbs/usageQuery', GOOD)); } return kind === 'fill' ? 'clicked' : true; } });
  assert.equal((await f.clock.run(f.web.autoRelogin({ fresh: true }), 15000)).summary, null); noSession(f); assert.equal(f.web.readAutoLoginReport().submitted, false); assert.equal(f.cmhk.readLoginRequests().length, 0);
});
test('strict verification rejects a usage-shaped shell instead of filling from historical data', async () => {
  const f = fixture(), before = seedHistorical(f);
  f.cmhk.setAutoReloginHandler(async () => ({ summary: { code: '000000', data: { usage: 99 } } }));
  await assert.rejects(f.clock.run(f.cmhk.refreshUsage({ autoLoginOnly: true })), /流量明细/);
  assert.equal(JSON.stringify(f.cmhk.readCache()), before); assert.equal(f.cmhk.readRefreshReport().ok, false);
});
test('a recent login snapshot cannot overwrite a newer cache before live refresh', async () => {
  const latest = structuredClone(GOOD); latest.data.result[0].details[0].margin = '39';
  const f = fixture({ fetch: async () => ({ ok: true, json: async () => latest }) }); f.session();
  f.cmhk.saveCapturedBody(JSON.stringify(GOOD)); f.clock.now += 20000;
  const cached = { ...f.cmhk.demoData(), dataRemainingGB: 40, fetchedAt: f.clock.now }; f.storage.set('cmhk.usage.cache', cached);
  const d = await f.clock.run(f.cmhk.refreshUsage({ snapshotFirst: true }));
  assert.equal(d.dataRemainingGB, 39); assert.ok(d.fetchedAt >= cached.fetchedAt); assert.equal(f.requests.length, 1);
});
test('manual capture keeps the later valid response after an earlier error at the same endpoint', async () => {
  const f = fixture({ setup: wv => { wv.emit(message(URL, { code: '999999', message: '未登錄' })); wv.emit(message()); } });
  const r = await f.clock.run(f.web.runWebLogin()); assert.equal(r.captured, true); assert.equal(JSON.parse(r.body).code, '000000');
});
test('initial blank document waits for navigation without receiving credentials', async () => {
  let f, dom, loaded = false, sent = false; const location = { href: 'about:blank' };
  f = fixture({ load: () => new Promise(resolve => f.clock.setTimeout(() => { loaded = true; location.href = 'https://www.hk.chinamobile.com/tc/login'; resolve(true); }, 500)),
    evaluate: (wv, kind) => { if (kind === 'hook' && loaded && !sent) { sent = true; authenticate(wv); } return kind === 'fill' ? dom.run() : kind === 'cookie' ? 'sid=fake' : true; } });
  dom = loginDom(f, { location }); assert.equal(dom.run(), 'loading'); assert.equal(dom.phone.value, '');
  const r = await f.clock.run(f.web.autoRelogin({ fresh: true })); assert.ok(r.summary); assert.ok(f.clock.now - f.clock.start >= 500); disposed(f);
});
test('fresh verification joins reordered confirmation and usage with late auth acceptance', async () => {
  let sent = false; const f = fixture({ evaluate: (wv, kind) => {
    if (kind === 'hook' && !sent) { sent = true; wv.emit(message(LOGIN + 'accountLogin', '')); wv.emit(message(LOGIN + 'successLogin', { code: '000000' })); wv.emit(message()); wv.emit(message(LOGIN + 'accountLogin', { code: '000000' })); }
    return kind === 'cookie' ? 'sid=fake' : true;
  } });
  assert.ok((await f.clock.run(f.web.autoRelogin({ fresh: true }))).summary); const r = f.web.readAutoLoginReport(); assert.equal(r.loginConfirmed, true); assert.equal(r.usageCaptured, true); disposed(f);
});
for (const change of ['rejection', 'manual priority']) test(`cookie-await ${change} prevents committing verified session`, async () => {
  let f; f = fixture({ evaluate: (wv, kind) => { if (kind === 'hook') authenticate(wv); return true; }, cookies: wv => {
    if (change === 'rejection') wv.emit(message(LOGIN + 'accountLogin', { code: '999999' })); else f.cmhk.tryBeginWebLogin();
    return Promise.resolve([{ name: 'sid', value: 'new-cookie' }]);
  } });
  f.session(); const before = JSON.stringify(f.cmhk.readWebSession());
  const r = await f.clock.run(f.web.autoRelogin({ fresh: true })); assert.equal(r.summary, null); assert.match(r.reason, change === 'rejection' ? /拒/ : /优先/);
  assert.equal(JSON.stringify(f.cmhk.readWebSession()), before); disposed(f);
});
test('fresh verification uses canonical usage entry instead of old login nonce', async () => {
  const f = fixture({ evaluate: (wv, kind) => { if (kind === 'hook') authenticate(wv); return kind === 'cookie' ? 'sid=fake' : true; } });
  f.cmhk.saveLoginPageUrl('https://www.hk.chinamobile.com/tc/login?nonce=old');
  assert.ok((await f.clock.run(f.web.autoRelogin({ fresh: true }))).summary);
  assert.equal(f.views[0].loads[0], 'https://www.hk.chinamobile.com/tc/home/my-zone/menu/usage-query');
});
(async () => { await compile(); let failed = 0; for (const [name, fn] of tests) { try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n${e.stack || e}`); } } console.log(`\n${tests.length - failed}/${tests.length} passed against ${ROOT}`); process.exitCode = failed ? 1 : 0; })().catch(e => { console.error(e); process.exitCode = 1; });
