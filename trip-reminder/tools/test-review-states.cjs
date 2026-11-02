#!/usr/bin/env node
'use strict';
// Execute real OCR review/save and archive edit/delete/statistics with native APIs kept in memory.
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
    stdin: { contents: 'import "./index"; export { parseTripText } from "./services/parse"; export { StationStateBadge } from "./components/trip-widget";', resolveDir: ROOT, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['scripting'], jsxFactory: '__jsx', jsxFragment: '__Fragment', logLevel: 'silent',
  });
  assert.equal(result.warnings.length, 0, 'source bundle must have no warnings');
  bundled = result.outputFiles[0].text;
}

function fixture(text = '', { candidates = [], trips = [], image = {}, recognize } = {}) {
  const storage = new Map(), rootStates = [], sheetChoices = [], sheets = [];
  if (trips.length) storage.set('rail.trips', JSON.parse(JSON.stringify(trips)));
  let states = rootStates, cursor = 0, root, tree, reloads = 0, picks = 0, recognitions = 0;
  const native = new Proxy({
    __esModule: false,
    Navigation: { present: async ({ element }) => { root = element; }, useDismiss: () => () => {} },
    Script: { exit() {} },
    useState(initial) {
      const bag = states, index = cursor++;
      if (!(index in bag)) bag[index] = typeof initial === 'function' ? initial() : initial;
      return [bag[index], value => { bag[index] = typeof value === 'function' ? value(bag[index]) : value; }];
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
    Photos: { pick: async () => { picks++; return [{ uiImage: async () => image }]; } },
    PHPickerFilter: { images: () => 'mock-images' },
    Vision: { recognizeText: async (input, options) => {
      recognitions++;
      return recognize ? recognize(input, options) : { text, candidates };
    } },
    Dialog: {
      alert: async options => { throw new Error(`Unexpected alert: ${JSON.stringify(options)}`); },
      actionSheet: async options => { sheets.push(options); return sheetChoices.shift(); },
    },
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(bundled, sandbox, { filename: 'review-states-memory.cjs' });
  assert.equal(typeof root?.type, 'function', 'Navigation.present must capture the actual root View');
  const { StationStateBadge } = sandbox.module.exports;
  const render = () => { states = rootStates; cursor = 0; tree = root.type(root.props); return tree; };
  // Only the pure badge expands; every other child component stays opaque.
  const nodes = (value = tree) => {
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) return value.flatMap(item => nodes(item));
    if (!value.type || !value.props) return [];
    if (value.type === StationStateBadge) return [value, ...nodes(StationStateBadge(value.props))];
    if (typeof value.type === 'function') return [value];
    return [value, ...Object.values(value.props).flatMap(item => nodes(item))];
  };
  const one = (type, title) => {
    const found = nodes().filter(node => node.type === type && node.props.title === title);
    assert.equal(found.length, 1, `expected one ${type} titled ${title}`);
    return found[0];
  };
  const texts = (value = tree) => nodes(value).filter(node => node.type === 'Text').map(textContent);
  render();
  return {
    storage, render, nodes, texts, one, StationStateBadge, sheets,
    chooseSheet: index => sheetChoices.push(index),
    parse: () => sandbox.module.exports.parseTripText(text),
    mountArchive() {
      const links = nodes().filter(node => node.type === 'NavigationLink' &&
        texts(node.props.children).some(text => /^查看归档记录（\d+）$/.test(text)));
      assert.equal(links.length, 1, 'must open the actual archive navigation link');
      const destination = links[0].props.destination, archiveStates = [];
      assert.equal(typeof destination?.type, 'function', 'archive destination must be the real ArchivePage');
      let archiveTree;
      const renderArchive = () => {
        states = archiveStates; cursor = 0;
        archiveTree = destination.type(destination.props);
        return archiveTree;
      };
      renderArchive();
      return {
        render: renderArchive, StationStateBadge,
        nodes: (value = archiveTree) => nodes(value),
        texts: (value = archiveTree) => texts(value),
        one(type, title) {
          const found = nodes(archiveTree).filter(node => node.type === type && node.props.title === title);
          assert.equal(found.length, 1, `expected one archive ${type} titled ${title}`);
          return found[0];
        },
      };
    },
    get reloads() { return reloads; },
    async ocr(expectedRecognitions = 1) {
      one('Button', '从相册选行程截图识别').props.action();
      await new Promise(resolve => setImmediate(resolve)); // The button uses void runOCR().
      render();
      assert.equal(picks, 1, 'must use Photos.pick');
      assert.equal(recognitions, expectedRecognitions, 'must run the expected bounded Vision recognition passes');
      one('Button', '保存行程');
    },
  };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const textContent = node => node.props.children.flat(Infinity).join('');
function label(f, expected) {
  assert.ok(f.texts().includes(expected), `missing visible review label: ${expected}`);
}
function badgeText(f, badge, glyph) {
  const texts = f.nodes(badge).filter(node => node.type === 'Text');
  assert.equal(texts.length, 1, 'a station badge must render one native Text');
  const text = texts[0];
  assert.equal(textContent(text), glyph);
  assert.equal(text.props.font, 9);
  assert.equal(text.props.frame?.width, 13);
  assert.equal(text.props.frame?.height, 12);
  assert.equal(text.props.clipShape?.type, 'rect');
  assert.equal(text.props.clipShape?.cornerRadius, 3);
  assert.equal(text.props.offset?.y, -1);
  return text;
}
function fieldState(f, title, glyph) {
  const field = f.one('TextField', title);
  const columns = f.nodes().filter(node => node.type === 'VStack' && node.props.children.flat(Infinity).includes(field));
  assert.equal(columns.length, 1, `${title} must have its own field column`);
  const headers = columns[0].props.children.flat(Infinity).filter(node => node?.type === 'HStack' &&
    f.texts(node).includes(title));
  assert.equal(headers.length, 1, `${title} must have a plain label in its own header HStack`);
  const header = headers[0], badges = f.nodes(header).filter(node => node.type === f.StationStateBadge);
  assert.equal(f.texts(columns[0]).some(text => text.startsWith(`${title} ·`)), false, 'status cannot be appended to the field label');
  if (glyph === '未识别') {
    assert.equal(badges.length, 0, `${title} must not show a badge without a matching fact`);
    assert.equal(f.texts(header).filter(text => text === '未识别').length, 1);
  } else {
    assert.equal(badges.length, 1, `${title} must show its actual StationStateBadge`);
    assert.equal(badges[0].props.state, { 起: 'origin', 过: 'intermediate', 终: 'terminal' }[glyph]);
    assert.equal(f.texts(header).includes('未识别'), false);
    badgeText(f, badges[0], glyph);
  }
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
  fieldState(f, '出发车站', '过');
  fieldState(f, '到达车站', '终');
  label(f, LEGEND);
});

test('origin and intermediate badges stay attached to the correct endpoint', async () => {
  const f = fixture(screenshot('起深圳北 → 过香港西九龙'));
  await f.ocr();
  fieldState(f, '出发车站', '起');
  fieldState(f, '到达车站', '过');
  label(f, LEGEND);
  assert.equal(f.one('TextField', '出发车站').props.value, '深圳北');
  assert.equal(f.one('TextField', '到达车站').props.value, '香港西九龙');
});

test('rail endpoints without explicit facts remain unrecognized', async () => {
  const f = fixture(screenshot('深圳北 → 香港西九龙'));
  assert.equal(f.parse().railStationStates, undefined);
  await f.ocr();
  fieldState(f, '出发车站', '未识别');
  fieldState(f, '到达车站', '未识别');
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
    fieldState(f, '出发车站', from);
    fieldState(f, '到达车站', to);
    label(f, LEGEND);
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
    assert.equal(f.nodes().some(node => node.type === f.StationStateBadge), false, 'flight fields must not render rail badges');
  }
});

test('save preserves parsed metadata, clean values, and the unmodified OCR text', async () => {
  const raw = screenshot('过深圳北 → 终香港西九龙') +
    '\n经停站\n起 广州南 始发 08:20\n过 深圳北 08:58 09:00 2分\n终 香港西九龙 09:18 终到';
  const f = fixture(raw);
  const parsed = JSON.parse(JSON.stringify(f.parse()));
  assert.equal(parsed.railStops.length, 3, 'fixture must exercise timetable metadata too');
  await f.ocr();
  fieldState(f, '出发车站', '过');
  fieldState(f, '到达车站', '终');
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

test('shared StationStateBadge renders all three glyphs with or without a theme and hides absent state', () => {
  const f = fixture(), theme = { ink: '#123456', accentSoft: '#abcdef' };
  assert.equal(typeof f.StationStateBadge, 'function');
  assert.equal(f.StationStateBadge({}), null);
  assert.equal(f.StationStateBadge({ theme }), null);
  for (const [state, glyph] of [['origin', '起'], ['intermediate', '过'], ['terminal', '终']]) {
    for (const colors of [undefined, theme]) {
      const text = badgeText(f, f.StationStateBadge({ state, theme: colors }), glyph);
      if (colors) {
        assert.equal(text.props.foregroundStyle, theme.ink);
        assert.equal(text.props.background, theme.accentSoft);
      }
    }
  }
});

function archiveFixtureTrips() {
  const rail = {
    id: 'archived-rail', mode: 'rail', code: 'G1234', carrier: '复兴号',
    fromPlace: '深圳北', toPlace: '香港西九龙', departDate: '2099-06-18',
    departTime: '09:00', arriveTime: '09:18', durationMin: 18,
    gate: '6A', seatCar: '05', seatNo: '12A', seatClass: '二等座', passenger: '测试乘客', note: '旧备注',
    createdAt: '2026-10-01T00:00:00.000Z', archivedAt: '2026-10-02T00:00:00.000Z',
    railStationStates: { code: 'G1234', stations: [
      { station: '深圳北', state: 'intermediate' }, { station: '香港西九龙', state: 'terminal' },
    ] },
    railStops: [
      { station: '深圳北', state: 'intermediate', arriveTime: '08:58', departTime: '09:00' },
      { station: '香港西九龙', state: 'terminal', arriveTime: '09:18' },
    ],
  };
  const flight = {
    id: 'archived-flight', mode: 'flight', code: 'CA1234', carrier: '测试航空',
    fromPlace: '测试机场甲', toPlace: '测试机场乙', departDate: '2099-06-19',
    departTime: '', arriveTime: '', durationMin: 0, terminal: 'T3', gate: 'C12',
    boardingTime: '08:00', checkIn: 'H01', baggage: '3', seatNo: '32A', seatClass: '经济舱',
    passenger: '测试乘客', note: '航班备注', createdAt: rail.createdAt, archivedAt: rail.archivedAt,
  };
  const active = { ...rail, id: 'active-rail', archivedAt: undefined, note: '保留未归档记录' };
  return [rail, flight, active];
}
function archiveRow(archive, id) {
  const rows = archive.nodes().filter(node => node.type === 'VStack' && node.props.key === id);
  assert.equal(rows.length, 1, `expected archive row ${id}`);
  return rows[0];
}

test('tapping an archive row saves shared fields in place without losing archive or rail metadata', () => {
  const trips = archiveFixtureTrips(), f = fixture('', { trips }), archive = f.mountArchive();
  archiveRow(archive, trips[0].id).props.onTapGesture();
  archive.render();
  f.render(); // Exercise archive callbacks after home has rendered with its own hook bag.
  for (const title of ['车次', '车型', '出发车站', '到达车站', '日期', '发车时间', '到达时间',
    '历时（分钟）', '检票口', '车厢', '座位号', '座别', '乘车人', '备注']) archive.one('TextField', title);
  fieldState(archive, '出发车站', '过');
  fieldState(archive, '到达车站', '终');
  const changes = [['出发车站', '测试新车站'], ['发车时间', '10:00'], ['到达时间', '10:45'],
    ['历时（分钟）', '45'], ['备注', '修改后的备注']];
  for (const [title, value] of changes) archive.one('TextField', title).props.onChanged(value);
  archive.render();
  fieldState(archive, '出发车站', '未识别');
  fieldState(archive, '到达车站', '终');
  assert.deepEqual(JSON.parse(JSON.stringify(f.storage.get('rail.trips'))), JSON.parse(JSON.stringify(trips)), 'draft changes must not save early');
  archive.one('Button', '保存行程').props.action();
  archive.render();
  const expected = { ...trips[0], fromPlace: '测试新车站', departTime: '10:00', arriveTime: '10:45', durationMin: 45, note: '修改后的备注' };
  assert.deepEqual(JSON.parse(JSON.stringify(f.storage.get('rail.trips'))), JSON.parse(JSON.stringify([expected, ...trips.slice(1)])),
    'save must preserve ids, timestamps, archivedAt, station facts, stops and every other record');
  archive.one('Section', '归档记录 (2)');
  assert.ok(archive.texts(archiveRow(archive, trips[0].id)).some(text => text.includes('测试新车站')));
  assert.ok(archive.texts().some(text => text.includes('修改后的备注')));
  assert.equal(archive.nodes().some(node => node.type === 'TextField' && node.props.title !== '搜索归档'), false, 'saving must close the in-place form');
  assert.equal(f.reloads, 1);
  f.render();
  label(f, '查看归档记录（2）');
  label(f, '3 条');
  f.one('Section', '行程列表 (1)');
});

test('swipe edit reuses flight fields and cancellation keeps storage, archive and home unchanged', () => {
  const trips = archiveFixtureTrips(), f = fixture('', { trips }), archive = f.mountArchive();
  const actions = archiveRow(archive, trips[1].id).props.trailingSwipeActions;
  assert.equal(actions.allowsFullSwipe, false);
  assert.deepEqual(Array.from(actions.actions, button => button.props.title), ['删除', '编辑']);
  actions.actions[1].props.action();
  archive.render();
  for (const title of ['航班号', '航空公司', '出发机场', '到达机场', '日期', '起飞时间', '到达时间',
    '历时（分钟）', '登机口', '航站楼', '登机时间', '值机柜台', '座位号', '舱位', '行李转盘', '乘机人', '备注']) archive.one('TextField', title);
  assert.equal(archive.nodes().some(node => node.type === archive.StationStateBadge), false);
  archive.one('TextField', '出发机场').props.onChanged('放弃的机场');
  archive.one('TextField', '起飞时间').props.onChanged('12:00');
  archive.one('TextField', '备注').props.onChanged('放弃的备注');
  archive.render();
  archive.one('Button', '放弃').props.action();
  archive.render();
  assert.deepEqual(JSON.parse(JSON.stringify(f.storage.get('rail.trips'))), JSON.parse(JSON.stringify(trips)));
  assert.equal(f.reloads, 0, 'cancelling must not write or refresh widgets');
  assert.equal(archive.nodes().some(node => node.type === 'TextField' && node.props.title !== '搜索归档'), false);
  assert.ok(archive.texts(archiveRow(archive, trips[1].id)).some(text => text.includes('测试机场甲')));
  assert.equal(archive.texts().some(text => /放弃的/.test(text)), false);
  f.render();
  label(f, '查看归档记录（2）');
  f.one('Section', '行程列表 (1)');
});

test('visible archive statistics refresh after edit and deletion, including unknown duration and empty archive', () => {
  const trips = archiveFixtureTrips(), f = fixture('', { trips }), archive = f.mountArchive();
  const stat = (title, value) => {
    const section = archive.one('Section', '出行统计');
    assert.ok(archive.nodes(section).some(node => node.type === 'HStack' &&
      archive.texts(node).includes(title) && archive.texts(node).includes(value)), `expected statistic ${title}: ${value}`);
  };
  const compact = () => {
    assert.equal(archive.nodes().some(node => node.type === 'Section' && node.props.title === '常用车站与机场'), false,
      'rankings belong on the detail page, leaving the archive compact');
    const links = archive.nodes().filter(node => node.type === 'NavigationLink' &&
      archive.texts(node.props.children).includes('查看详细统计'));
    assert.equal(links.length, 1, 'archive must retain the detail navigation link');
    assert.equal(typeof links[0].props.destination?.type, 'function');
  };
  stat('累计行程', '2 次');
  stat('累计时长', '0 小时 18 分钟');
  compact();
  label(archive, '已计入 1 次行程的时长；1 次缺少时长，未计入。');
  archiveRow(archive, trips[0].id).props.onTapGesture();
  archive.render();
  archive.one('TextField', '出发车站').props.onChanged('统计新城');
  archive.one('TextField', '历时（分钟）').props.onChanged('78');
  archive.render();
  stat('累计时长', '0 小时 18 分钟'); // Only a saved draft can change the totals.
  archive.one('Button', '保存行程').props.action();
  archive.render();
  stat('累计时长', '1 小时 18 分钟');
  stat('累计行程', '2 次');
  compact();
  archiveRow(archive, trips[0].id).props.trailingSwipeActions.actions[0].props.action();
  archive.render();
  stat('累计行程', '1 次');
  stat('累计时长', '暂无可用时长');
  compact();
  label(archive, '已计入 0 次行程的时长；1 次缺少时长，未计入。');
  archiveRow(archive, trips[1].id).props.trailingSwipeActions.actions[0].props.action();
  archive.render();
  stat('累计行程', '0 次');
  stat('累计时长', '暂无可用时长');
  compact();
  label(archive, '已计入 0 次行程的时长。');
  label(archive, '暂无归档记录。');
  assert.equal(archive.nodes().some(node => node.type === 'Section' && node.props.title === '常用车站与机场'), false);
  assert.equal(archive.texts().some(text => /NaN|Infinity|缺少时长/.test(text)), false);
  assert.deepEqual(JSON.parse(JSON.stringify(f.storage.get('rail.trips'))), JSON.parse(JSON.stringify([trips[2]])));
  assert.equal(f.reloads, 3);
  f.render();
  label(f, '查看归档记录（0）');
  label(f, '1 条');
  f.one('Section', '行程列表 (1)');
});

test('archive row swipe deletion preserves other trips and refreshes archive and home through empty state', () => {
  const trips = ['archive-one', 'archive-two', 'active'].map((id, index) => ({
    id, mode: 'rail', code: `G100${index + 1}`, fromPlace: '深圳北', toPlace: '香港西九龙',
    departDate: '2099-06-18', departTime: `0${index + 7}:00`, arriveTime: `0${index + 7}:18`, durationMin: 18,
    seatCar: '05', seatNo: '12A', seatClass: '二等座', passenger: '回归乘客', note: id,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...(index < 2 ? { archivedAt: '2026-10-02T00:00:00.000Z' } : {}),
  }));
  const f = fixture('', { trips }), archive = f.mountArchive();
  const rows = count => {
    const sections = archive.nodes().filter(node => node.type === 'Section' && node.props.title === `归档记录 (${count})`);
    assert.equal(sections.length, 1, 'archive count must refresh in the mounted page');
    const records = sections[0].props.children.flat(Infinity).filter(node => node?.type === 'VStack');
    assert.equal(records.length, count, 'each archive record must be a direct list row');
    return records;
  };
  const swipe = row => {
    assert.ok(row, 'must find the selected archive row');
    const actions = row.props.trailingSwipeActions;
    assert.equal(actions?.allowsFullSwipe, false, 'archive deletion must require the revealed action');
    assert.equal(actions.actions.length, 2);
    assert.equal(actions.actions[1].type, 'Button');
    assert.equal(actions.actions[1].props.title, '编辑', 'editing must follow the existing delete action');
    const button = actions.actions[0];
    assert.equal(button.type, 'Button');
    assert.equal(button.props.title, '删除');
    assert.equal(button.props.role, 'destructive');
    assert.equal(typeof button.props.action, 'function');
    return button.props.action;
  };
  label(f, '查看归档记录（2）');
  label(f, '3 条');
  f.one('Section', '行程列表 (1)');
  const initial = rows(2);
  initial.forEach(swipe);
  assert.equal(archive.texts().includes('暂无归档记录。'), false);
  const removeFirst = swipe(initial.find(row => row.props.key === 'archive-one'));
  f.render(); // Both mounted pages must retain their own hook state across callbacks.
  removeFirst();
  archive.render();
  assert.equal(rows(1)[0].props.key, 'archive-two');
  assert.equal(archive.texts().includes('暂无归档记录。'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(f.storage.get('rail.trips'))), trips.slice(1), 'only the selected archive id may be deleted');
  assert.equal(f.reloads, 1);
  f.render();
  label(f, '查看归档记录（1）');
  label(f, '2 条');
  f.one('Section', '行程列表 (1)');
  const removeLast = swipe(rows(1)[0]);
  removeLast();
  archive.render();
  rows(0);
  assert.equal(archive.texts().filter(text => text === '暂无归档记录。').length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.storage.get('rail.trips'))), [trips[2]], 'the active trip must survive deleting every archived record');
  assert.equal(f.reloads, 2);
  f.render();
  label(f, '查看归档记录（0）');
  label(f, '1 条');
  f.one('Section', '行程列表 (1)');
});

test('archive search keeps full-list serials and matches case, route, date, notes and carrier without writes', () => {
  const trips = archiveFixtureTrips();
  trips[1].departTime = '10:00';
  const f = fixture('', { trips }), archive = f.mountArchive();
  const section = archive.one('Section', '查找归档');
  assert.equal(archive.one('TextField', '搜索归档').props.prompt, '车次、站点、日期或备注');
  assert.ok(archive.texts(section).includes('筛选只影响下方记录列表，统计仍按全部归档。'));
  const serial = (id, expected) => {
    const number = archive.nodes(archiveRow(archive, id)).find(node => node.type === 'Text' && node.props.accessibilityLabel === `归档序号 ${expected}`);
    assert.ok(number, 'archive number retains its spoken meaning');
    assert.equal(textContent(number), String(expected).padStart(2, '0'));
  };
  serial(trips[1].id, 1);
  serial(trips[0].id, 2);
  for (const query of [' g1234 ', '深圳北 香港西九龙', '2099-06-18', '旧备注', '复兴号', 'G1234 深圳北 2099-06-18 旧备注']) {
    archive.one('TextField', '搜索归档').props.onChanged(query);
    archive.render();
    serial(trips[0].id, 2);
    label(archive, '显示 1 / 2 条');
    assert.equal(archive.nodes().some(node => node.props.key === trips[1].id), false);
    label(archive, '2 次');
  }
  archive.one('TextField', '搜索归档').props.onChanged('no-match');
  archive.render();
  label(archive, '显示 0 / 2 条');
  label(archive, '没有匹配的归档记录，可清除筛选。');
  archive.one('Button', '清除筛选').props.action();
  archive.render();
  label(archive, '显示 2 / 2 条');
  assert.equal(archive.one('TextField', '搜索归档').props.value, '');
  assert.equal(archive.nodes().some(node => node.type === 'Button' && node.props.title === '清除筛选'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(f.storage.get('rail.trips'))), JSON.parse(JSON.stringify(trips)));
  assert.equal(f.reloads, 0);
});

test('archive native year and mode rows combine filters, cancel safely and clear all selections', async () => {
  const trips = archiveFixtureTrips();
  trips[1].departDate = '2098-06-19';
  const f = fixture('', { trips }), archive = f.mountArchive();
  const choose = async (title, index) => {
    f.chooseSheet(index);
    archive.one('Button', title).props.action();
    await new Promise(resolve => setImmediate(resolve));
    archive.render();
  };
  await choose('归档年份：全部年份', 1);
  assert.deepEqual(Array.from(f.sheets.at(-1).actions, action => action.label), ['全部年份', '2099年', '2098年']);
  assert.equal(f.sheets.at(-1).cancelButton, true);
  label(archive, '显示 1 / 2 条');
  label({ texts: () => archive.texts(archiveRow(archive, trips[0].id)) }, '01');
  await choose('归档方式：全部方式', 2);
  assert.deepEqual(Array.from(f.sheets.at(-1).actions, action => action.label), ['全部方式', '火车', '航班']);
  label(archive, '显示 0 / 2 条');
  await choose('归档年份：2099年', 2);
  label(archive, '显示 1 / 2 条');
  archiveRow(archive, trips[1].id);
  await choose('归档年份：2098年', null);
  archive.one('Button', '归档年份：2098年');
  archive.one('TextField', '搜索归档').props.onChanged('CA1234');
  archive.render();
  archive.one('Button', '清除筛选').props.action();
  archive.render();
  archive.one('Button', '归档年份：全部年份');
  archive.one('Button', '归档方式：全部方式');
  assert.equal(archive.one('TextField', '搜索归档').props.value, '');
  label(archive, '显示 2 / 2 条');
  label(archive, '2 次');
  assert.equal(f.reloads, 0);
});

test('filtered archive edit and delete target the selected id and filter changes close unsaved drafts', () => {
  const trips = archiveFixtureTrips();
  trips[1].departTime = '10:00';
  const f = fixture('', { trips }), archive = f.mountArchive();
  const search = query => { archive.one('TextField', '搜索归档').props.onChanged(query); archive.render(); };
  search('g1234');
  archiveRow(archive, trips[0].id).props.trailingSwipeActions.actions[1].props.action();
  archive.render();
  archive.one('TextField', '备注').props.onChanged('放弃的归档修改');
  search('CA1234');
  assert.equal(archive.nodes().some(node => node.type === 'Button' && node.props.title === '保存行程'), false);
  archiveRow(archive, trips[1].id);
  search('g1234');
  archiveRow(archive, trips[0].id).props.onTapGesture();
  archive.render();
  archive.one('TextField', '备注').props.onChanged('筛选后保存');
  archive.render();
  archive.one('Button', '保存行程').props.action();
  archive.render();
  label({ texts: () => archive.texts(archiveRow(archive, trips[0].id)) }, '02');
  const saved = f.storage.get('rail.trips');
  assert.equal(saved.find(trip => trip.id === trips[0].id).note, '筛选后保存');
  assert.deepEqual(JSON.parse(JSON.stringify(saved.filter(trip => trip.id !== trips[0].id))), JSON.parse(JSON.stringify(trips.slice(1))));
  archiveRow(archive, trips[0].id).props.trailingSwipeActions.actions[0].props.action();
  archive.render();
  label(archive, '没有匹配的归档记录，可清除筛选。');
  archive.one('Button', '清除筛选').props.action();
  archive.render();
  label({ texts: () => archive.texts(archiveRow(archive, trips[1].id)) }, '01');
  assert.deepEqual(JSON.parse(JSON.stringify(f.storage.get('rail.trips'))), JSON.parse(JSON.stringify(trips.slice(1))));
  assert.equal(f.reloads, 2);
  f.render();
  label(f, '查看归档记录（1）');
  f.one('Section', '行程列表 (1)');
});

test('real Vision single-station candidates require reliable direction and preserve explicit endpoints', async () => {
  for (const [route, timeCount, x, from, to] of [
    ['', 2, 0.10, '深圳北', ''],
    ['', 2, 0.70, '', '深圳北'],
    ['', 1, 0.10, '', ''],
    ['过深圳北', 2, 0.10, '深圳北', ''],
    ['过深圳北', 2, 0.70, '深圳北', ''],
  ]) {
    const times = [
      { content: '09:00', confidence: 1, boundingBox: { x: 0.05, y: 0.68, width: 0.16, height: 0.06 } },
      { content: '09:18', confidence: 1, boundingBox: { x: 0.75, y: 0.68, width: 0.16, height: 0.06 } },
    ];
    const candidates = [
      ...times.slice(0, timeCount),
      { content: '过深圳北站', confidence: 1, boundingBox: { x, y: 0.58, width: 0.25, height: 0.06 } },
    ];
    const raw = timeCount === 1 ? `G1234\n2099-06-18\n09:00\n${route}` : screenshot(route);
    const before = JSON.stringify(candidates), f = fixture(raw, { candidates });
    await f.ocr();
    assert.deepEqual([
      f.one('TextField', '出发车站').props.value,
      f.one('TextField', '到达车站').props.value,
    ], [from, to], `station x=${x}, time columns=${timeCount}, explicit route=${route || '(none)'}`);
    fieldState(f, '出发车站', from ? '过' : '未识别');
    fieldState(f, '到达车站', to ? '过' : '未识别');
    label(f, LEGEND);
    assert.equal(JSON.stringify(candidates), before, 'OCR candidates must remain unmodified');
    assert.equal(f.storage.has('rail.trips'), false);
  }
});

test('actual phone OCR recovers local ROI station badges without replacing the original text', async () => {
  const raw = '品\nG1234\n复兴号\n09:00\n过\n】 深圳北>\n乘车人：[已隐去]\n检票口Q：6A检票口\n座位号：05车12A二等座\n6月18日（周一）、\n历时18分\n出发 请以实际为准\n09:18\n香港西九龙〉\n改签\n灵活行\n乘车码\n退票';
  assert.equal(raw.includes('终'), false, 'the original phone OCR must have no terminal marker');
  for (const origin of ['unavailable', 'top', 'bottom', 'failed']) {
    const bottomOrigin = origin === 'bottom', crops = [], calls = [];
    const candidate = (content, x, y, width, height) => ({
      content, confidence: 1,
      boundingBox: { x, y: bottomOrigin ? 1 - y - height : y, width, height },
    });
    const candidates = [
      candidate('09:00', 0.06, 0.25, 0.18, 0.07),
      candidate('09:18', 0.74, 0.25, 0.20, 0.07),
      candidate('】 深圳北>', 0.08, 0.36, 0.24, 0.05),
      candidate('香港西九龙〉', 0.68, 0.36, 0.30, 0.05),
    ];
    const before = JSON.stringify(candidates);
    const image = origin === 'unavailable' ? {} : {
      width: 1206, height: 806,
      renderedIn(size, source) {
        const cropImage = { size, source };
        crops.push(cropImage);
        return cropImage;
      },
    };
    const f = fixture(raw, { candidates, image, recognize: async (input, options) => {
      calls.push({ input, options });
      if (input === image) return { text: raw, candidates };
      assert.ok(crops.includes(input), 'retry must recognize the image returned by renderedIn');
      const { position, size } = input.source;
      const top = position.y / image.height, span = size.height / image.height;
      const clockTop = 0.25, clockBottom = 0.32;
      if (origin === 'failed' || top > clockTop || top + span < clockBottom) {
        return { text: '09:00\n终 深圳东〉', candidates: [candidate('终 深圳东〉', 0.08, 0.36, 0.24, 0.05)] };
      }
      const offset = bottomOrigin ? 1 - top - span : top;
      const recovered = candidates.map((c, i) => ({
        ...c, content: ['09:00', '09:18', '过 深圳北〉', '终 香港西九龙〉'][i],
        boundingBox: { ...c.boundingBox, y: (c.boundingBox.y - offset) / span, height: c.boundingBox.height / span },
      }));
      return { text: '09:00\n09:18\n过 深圳北〉\n终 香港西九龙〉', candidates: recovered };
    } });
    const enhanced = origin === 'top' || origin === 'bottom';
    await f.ocr(origin === 'unavailable' ? 1 : origin === 'top' ? 2 : 3);
    assert.equal(f.one('TextField', '出发车站').props.value, '深圳北', origin);
    assert.equal(f.one('TextField', '到达车站').props.value, '香港西九龙', origin);
    fieldState(f, '出发车站', '过');
    fieldState(f, '到达车站', enhanced ? '终' : '未识别');
    label(f, LEGEND);
    assert.equal(crops.length, calls.length - 1, 'each retry must use one local crop');
    for (const { options } of calls) assert.equal(options.minimumTextHeight, 0.005);
    for (const { size, source } of crops) {
      assert.equal(source.position.x, 0);
      assert.equal(source.size.width, image.width);
      assert.ok(source.position.y >= 0 && source.position.y + source.size.height <= image.height);
      assert.ok(source.size.height < image.height, 'retry must crop the clock/station band');
      assert.ok(size.width > image.width && size.height > source.size.height, 'retry must upscale the band');
    }
    f.one('Toggle', '查看识别原文（用于排查识别不准）').props.onChanged(true);
    f.render();
    label(f, raw);
    assert.equal(f.texts().includes('09:00\n09:18\n过 深圳北〉\n终 香港西九龙〉'), false, 'ROI text must not replace original OCR');
    assert.equal(JSON.stringify(candidates), before, 'retry must preserve original candidates');
    assert.equal(f.storage.has('rail.trips'), false, 'review must precede saving');
    if (enhanced) {
      f.one('Button', '保存行程').props.action();
      const saved = f.storage.get('rail.trips');
      assert.equal(saved.length, 1);
      assert.deepEqual(JSON.parse(JSON.stringify(saved[0].railStationStates)), { code: 'G1234', stations: [
        { station: '深圳北', state: 'intermediate' }, { station: '香港西九龙', state: 'terminal' },
      ] });
      assert.equal(f.reloads, 1);
    }
  }
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
