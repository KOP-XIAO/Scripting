#!/usr/bin/env node
'use strict';
// Actual page components with isolated hook state and synthetic, memory-only native APIs.
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const ROOT = path.resolve(__dirname, '..');
let bundled;
const trip = (id, fields = {}) => ({
  id, mode: 'rail', code: 'G1001', fromPlace: '测试甲', toPlace: '测试乙',
  departDate: '2099-01-03', departTime: '', arriveTime: '', durationMin: 60,
  createdAt: '2099-01-01T00:00:00Z', archivedAt: '2099-01-04T00:00:00Z', ...fields,
});
const records = () => [
  trip('rail-2099'), trip('flight-2099', { mode: 'flight', fromPlace: '测试机场甲', toPlace: '测试机场乙', durationMin: 120 }),
  trip('rail-2098', { departDate: '2098-02-04', durationMin: 30 }),
  trip('active', { archivedAt: undefined, durationMin: 9999 }),
];
function fixture(trips = records(), themeKey = 'ticket') {
  const storage = new Map([['rail.trips', JSON.parse(JSON.stringify(trips))], ['rail.theme', themeKey]]);
  const bags = new Map(), answers = [], sheets = [];
  let activeBag, cursor = 0, root;
  const native = new Proxy({
    Navigation: { present: async ({ element }) => { root = element; }, useDismiss: () => () => {} },
    Script: { exit() {} }, useEffect() {}, useObservable: () => ({ value: 'home' }),
    useState(initial) {
      const bag = activeBag, index = cursor++;
      if (!(index in bag)) bag[index] = typeof initial === 'function' ? initial() : initial;
      return [bag[index], value => { bag[index] = typeof value === 'function' ? value(bag[index]) : value; }];
    },
  }, { get: (target, key) => key in target ? target[key] : key });
  const sandbox = {
    module: { exports: {} }, console,
    __jsx: (type, props, ...children) => ({ type, props: { ...props, children } }), __Fragment: 'Fragment',
    require(name) { assert.equal(name, 'scripting'); return native; },
    Storage: { get: key => storage.get(key), set: (key, value) => { storage.set(key, value); return true; }, remove: key => storage.delete(key) },
    Widget: { reloadAll() {} },
    Dialog: {
      alert: async options => { throw new Error(`Unexpected alert: ${JSON.stringify(options)}`); },
      actionSheet: async options => {
        sheets.push(options);
        assert.ok(answers.length, 'every action sheet must have a queued answer');
        return answers.shift()(options);
      },
    },
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(bundled, sandbox, { filename: 'statistics-ui-memory.cjs' });
  function invoke(element) {
    const previous = activeBag, previousCursor = cursor;
    if (!bags.has(element.type)) bags.set(element.type, []);
    activeBag = bags.get(element.type); cursor = 0;
    try { return element.type(element.props); }
    finally { activeBag = previous; cursor = previousCursor; }
  }
  function expand(value, width = 240) {
    if (Array.isArray(value)) return value.map(item => expand(item, width));
    if (!value || typeof value !== 'object' || !value.type) return value;
    if (typeof value.type === 'function') return expand(invoke(value), width);
    if (value.type === 'GeometryReader') {
      const render = value.props.render || value.props.children.flat(Infinity).find(child => typeof child === 'function');
      assert.equal(typeof render, 'function', 'GeometryReader must expose the actual render callback');
      return { ...value, props: { ...value.props, children: [expand(render({ size: { width, height: 120 } }), width)] } };
    }
    return { ...value, props: { ...value.props, children: expand(value.props.children, width) } };
  }
  function nodes(value) {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!value || typeof value !== 'object' || !value.type) return [];
    return [value, ...nodes(value.props.children), ...nodes(value.props.footer)];
  }
  const texts = tree => nodes(tree).filter(node => node.type === 'Text').map(node => node.props.children.flat(Infinity).join(''));
  function mount(element, recursive = false) {
    assert.equal(typeof element?.type, 'function', 'navigation must target an actual component');
    let tree;
    const page = { render(width = 240) { tree = recursive ? expand(element, width) : invoke(element); return tree; },
      nodes: () => nodes(tree), texts: () => texts(tree), get tree() { return tree; } };
    page.render(); return page;
  }
  const home = mount(root);
  const link = (page, label) => {
    const links = page.nodes().filter(node => node.type === 'NavigationLink' && texts(node).includes(label));
    assert.equal(links.length, 1, `expected actual navigation link ${label}`);
    return links[0].props.destination;
  };
  const archiveLabel = home.texts().find(text => /^查看归档记录（\d+）$/.test(text));
  const archiveElement = link(home, archiveLabel), archive = mount(archiveElement);
  const detailElement = link(archive, '查看详细统计'), detail = mount(detailElement, true);
  return { storage, home, archive, detail, archiveElement, detailElement, sheets, nodes, texts,
    exports: sandbox.module.exports,
    async choose(buttonText, optionText) {
      const buttons = detail.nodes().filter(node => node.type === 'Button' &&
        [node.props.title, ...texts(node)].some(label => typeof label === 'string' && label.includes(buttonText)));
      assert.equal(buttons.length, 1, `expected selector button ${buttonText}`);
      answers.push(options => {
        const items = options.actions || options.options;
        assert.ok(Array.isArray(items), 'action sheet must provide options');
        const index = items.findIndex(item => (typeof item === 'string' ? item : (item.label || item.title)) === optionText);
        assert.ok(index >= 0, `missing action sheet option ${optionText}`);
        return index;
      });
      await buttons[0].props.action();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(answers.length, 0, 'selector must consume the queued action sheet');
      detail.render();
    },
  };
}
function visible(page, ...labels) {
  for (const label of labels) assert.ok(page.texts().includes(label), `missing actual visible text: ${label}`);
  assert.equal(page.texts().some(text => /NaN|Infinity/.test(text)), false);
}
const tests = [];
const test = (name, run) => tests.push([name, run]);

function statistic(f, label, value) {
  assert.ok(f.detail.nodes().some(node => ['VStack', 'HStack'].includes(node.type) &&
    f.texts(node).includes(label) && f.texts(node).includes(value)), `expected ${label}: ${value}`);
}
function rankedNames(f) {
  const section = f.detail.nodes().find(node => node.type === 'Section' && node.props.title === '常用车站与机场');
  return section.props.children.flat(Infinity).filter(node => node?.type === 'HStack').map(node => f.texts(node));
}
test('actual archive navigation propagates light/dark themes and detail reads latest saved edits and deletes', () => {
  for (const themeKey of ['ticket', 'midnight']) {
    const f = fixture(records(), themeKey), theme = f.exports.THEMES[themeKey];
    assert.equal(f.archiveElement.props.theme.ink, theme.ink, 'home must pass the chosen theme to archive');
    assert.equal(f.detailElement.props.theme.ink, theme.ink, 'archive must pass the theme to detail');
    assert.equal(f.detail.tree.props.foregroundStyle, undefined, 'native List chrome must retain adaptive system foreground');
    assert.ok(f.detail.nodes().some(node => node.props.background === theme.cardTop));
    statistic(f, '累计行程', '3 次'); statistic(f, '累计时长', '3 小时 30 分钟');
    assert.equal(f.archive.nodes().some(node => node.type === 'Section' && node.props.title === '常用车站与机场'), false);
    const saved = f.storage.get('rail.trips');
    f.storage.set('rail.trips', saved.map(record => record.id === 'rail-2099' ? { ...record, fromPlace: '测试新城', durationMin: 90 } : record));
    f.home.render(); f.detail.render();
    statistic(f, '累计时长', '4 小时');
    assert.ok(rankedNames(f).some(row => row.includes('测试新城')), 'mounted detail must read the new endpoint');
    f.storage.set('rail.trips', f.storage.get('rail.trips').filter(record => !record.archivedAt));
    f.archive.render(); f.detail.render();
    statistic(f, '累计行程', '0 次'); statistic(f, '累计时长', '暂无时长');
    assert.equal(rankedNames(f).length, 0);
  }
});
test('year and mode action sheets change actual totals, duration, monthly trend and rankings independently', async () => {
  const f = fixture();
  await f.choose('年份：', '2099 年');
  statistic(f, '累计行程', '2 次'); statistic(f, '累计时长', '3 小时');
  visible(f.detail, '图示 2 次行程');
  f.home.render(); f.archive.render();
  await f.choose('出行方式：', '航班');
  statistic(f, '累计行程', '1 次'); statistic(f, '累计时长', '2 小时');
  visible(f.detail, '图示 1 次行程', '已知时长 1 次 · 缺少时长 0 次');
  assert.equal(rankedNames(f).length, 2);
  assert.ok(rankedNames(f).every(row => row.some(text => text.startsWith('航班 ·'))));
  await f.choose('出行方式：', '火车');
  statistic(f, '累计行程', '1 次'); statistic(f, '累计时长', '1 小时');
  await f.choose('年份：', '2098 年');
  statistic(f, '累计时长', '30 分钟'); visible(f.detail, '图示 1 次行程');
  await f.choose('出行方式：', '航班');
  statistic(f, '累计行程', '0 次'); statistic(f, '平均每次', '暂无可用时长');
  assert.equal(rankedNames(f).length, 0);
  await f.choose('年份：', '全部年份');
  statistic(f, '累计行程', '1 次'); statistic(f, '累计时长', '2 小时');
});
test('place metric actions render departure and arrival rankings from the selected records', async () => {
  const f = fixture([trip('a'), trip('b', { fromPlace: '测试丙', toPlace: '测试乙' })]);
  assert.ok(rankedNames(f)[0].includes('测试乙'), 'combined ranking must put the twice-arrived endpoint first');
  await f.choose('站点排行：', '出发');
  assert.equal(rankedNames(f).length, 2);
  assert.equal(rankedNames(f).some(row => row.includes('测试乙')), false, 'zero-departure endpoint must disappear');
  await f.choose('站点排行：', '到达');
  assert.equal(rankedNames(f).length, 1);
  assert.ok(rankedNames(f)[0].includes('测试乙') && rankedNames(f)[0].includes('2 次'));
  statistic(f, '累计行程', '2 次');
  await f.choose('站点排行：', '合计');
  assert.equal(rankedNames(f).length, 3);
});
// These assertions inspect native view structure and callbacks, not iOS List measurement or pixels.
test('native chrome remains adaptive while every card body label has an explicit theme color', () => {
  for (const themeKey of Object.keys(fixture().exports.THEMES)) {
    for (const trips of [records(), []]) {
      const f = fixture(trips, themeKey), theme = f.exports.THEMES[themeKey];
      assert.equal(f.detail.tree.type, 'List');
      assert.equal(f.detail.tree.props.foregroundStyle, undefined);
      for (const section of f.detail.nodes().filter(node => node.type === 'Section')) {
        assert.equal(section.props.foregroundStyle, undefined, 'section headings must not inherit card ink');
        const footer = section.props.footer;
        if (footer) assert.equal(footer.props.foregroundStyle, 'secondaryLabel');
        const bodyLabels = f.nodes(section.props.children).filter(node => node.type === 'Text');
        for (const label of bodyLabels) {
          assert.ok([theme.ink, theme.sub, theme.accent].includes(label.props.foregroundStyle),
            `unthemed body label: ${f.texts(label).join('')}`);
        }
      }
      const filters = f.detail.nodes().filter(node => node.type === 'Button');
      assert.equal(filters.length, 3);
      for (const button of filters) {
        const label = f.nodes(button).find(node => node.type === 'Text');
        assert.equal(label.props.foregroundStyle, theme.accent, 'filter labels must override system blue on themed rows');
      }
    }
  }
});
test('monthly chart reserves native stack height, equal flexible columns and bottom-anchored bars', () => {
  const f = fixture(records(), 'midnight');
  for (const width of [201, 260, 320]) {
    f.detail.render(width);
    const section = f.detail.nodes().find(node => node.type === 'Section' && node.props.title === '月度趋势');
    const row = section.props.children.flat(Infinity).find(node => node?.type === 'VStack');
    assert.ok(row.props.frame.minHeight >= 250, 'the populated native List row must reserve the entire chart and captions');
    assert.equal(f.nodes(section).some(node => node.type === 'GeometryReader'), false,
      'monthly chart sizing must not depend on GeometryReader in List flow');
    const children = row.props.children.flat(Infinity).filter(node => node?.type);
    const chart = children.find(node => node.type === 'HStack' && node.props.frame?.height === 170);
    assert.ok(chart, 'chart must report a fixed 170-point height to the row');
    const columns = chart.props.children.flat(Infinity).filter(node => node?.type);
    assert.equal(columns.length, 12);
    assert.ok(12 * 12 + 11 * chart.props.spacing <= width, 'fixed bars and column gaps fit narrow content widths');
    for (const column of columns) {
      assert.equal(column.type, 'VStack');
      assert.equal(column.props.frame.minWidth, 0);
      assert.equal(column.props.frame.maxWidth, 'infinity');
      assert.equal(column.props.frame.width, undefined, 'native HStack must distribute equal flexible columns');
      assert.equal(column.props.frame.minHeight, 170);
      assert.equal(column.props.frame.maxHeight, 170);
      const [count, barArea, month] = column.props.children.flat(Infinity);
      assert.equal(count.props.frame.height, 20);
      assert.equal(barArea.type, 'VStack');
      assert.equal(barArea.props.frame.height, 122);
      assert.equal(month.props.frame.height, 20);
      assert.equal(20 + 122 + 20 + 2 * column.props.spacing, 170);
      assert.equal(barArea.props.frame.alignment, 'bottom');
      const bars = barArea.props.children.flat(Infinity);
      assert.equal(bars.length, 1, 'the maximum-height bar must not compete with a Spacer minimum length');
      const [bar] = bars;
      assert.equal(bar.type, 'RoundedRectangle');
      assert.equal(bar.props.frame.width, 12);
      const total = Number(f.texts(count)[0]);
      assert.equal(bar.props.frame.height, total / 2 * 122, 'bar heights retain the actual counts and maximum');
      assert.equal(f.texts(month)[0], column.props.key.slice(5));
    }
    const peakIndex = children.findIndex(node => node.type === 'Text' && f.texts(node)[0].startsWith('最多出行：'));
    assert.ok(peakIndex > children.indexOf(chart), 'peak caption must occupy a sibling slot after the whole chart');
    assert.equal(children[peakIndex].props.lineLimit, 2);
    for (const node of f.detail.nodes().filter(node => node.type === 'VStack' && node.props.accessibilityHidden)) {
      assert.equal(node.props.frame.height, 6, 'frequency readers need a fixed-height outer native stack');
      assert.equal(node.props.children.flat(Infinity)[0].type, 'GeometryReader');
    }
  }
  const empty = fixture([]);
  const section = empty.detail.nodes().find(node => node.type === 'Section' && node.props.title === '月度趋势');
  const row = section.props.children.flat(Infinity).find(node => node?.type === 'VStack');
  assert.equal(row.props.frame.minHeight, 0, 'empty chart copy must not reserve a tall blank chart');
});
test('empty, unknown and year-zero records keep truthful labels and finite bounded zero geometry', async () => {
  for (const trips of [[], [trip('unknown', { departDate: 'unknown', durationMin: 0, fromPlace: '', toPlace: '' })]]) {
    const f = fixture(trips);
    statistic(f, '累计行程', `${trips.length} 次`);
    statistic(f, '平均每次', '暂无可用时长'); statistic(f, '最长行程', '暂无可用时长');
    visible(f.detail, '图示 0 次行程', '已知时长 0 次 · 缺少时长 ' + trips.length + ' 次');
    assert.ok(f.detail.texts().some(text => text.includes('当前范围暂无地点记录')));
    if (trips.length) assert.ok(f.detail.texts().some(text => text.includes('1 次缺少有效日期，未计入趋势和出行天数')));
    for (const width of [0, 80, 240]) {
      f.detail.render(width);
      const fills = f.detail.nodes().filter(node => node.type === 'RoundedRectangle' && node.props.fill === f.detailElement.props.theme.accent);
      assert.ok(fills.length >= 2);
      assert.ok(fills.every(node => Number.isFinite(node.props.frame.width) && node.props.frame.width >= 0 && node.props.frame.width <= width));
      assert.equal(fills.filter(node => node.props.frame.width === 0).length, width === 0 || trips.length === 0 ? 2 : 1,
        'each zero mode count must draw a zero-width fill; an unknown date still counts as a trip');
    }
  }
  const f = fixture([trip('year-zero', { departDate: '0000-02-29', durationMin: 0 })]);
  await f.choose('年份：', '0 年');
  statistic(f, '累计行程', '1 次'); visible(f.detail, '图示 1 次行程', '已知时长 0 次 · 缺少时长 1 次');
  for (const width of [201, 260, 320]) {
    f.detail.render(width);
    const columns = f.detail.nodes().filter(node => node.type === 'VStack' && /^0000-\d\d$/.test(node.props.key || ''));
    assert.equal(columns.length, 12);
    for (const column of columns) {
      const bar = f.nodes(column).find(node => node.type === 'RoundedRectangle');
      const zero = column.props.key !== '0000-02';
      assert.ok(Number.isFinite(bar.props.frame.width) && bar.props.frame.width >= 0 && bar.props.frame.width <= width);
      assert.ok(Number.isFinite(bar.props.frame.height) && bar.props.frame.height >= 0 && bar.props.frame.height <= 122);
      assert.equal(bar.props.frame.height === 0, zero, 'zero months must have zero height, not decorative positive bars');
      assert.ok(column.props.accessibilityLabel.includes(zero ? '：0 次' : '：1 次'));
    }
  }
});

(async () => {
  const result = await esbuild.build({
    stdin: { contents: 'import "./index"; export { THEMES } from "./services/theme"; export { archiveInsights } from "./services/statistics";', resolveDir: ROOT, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['scripting'],
    jsxFactory: '__jsx', jsxFragment: '__Fragment', logLevel: 'silent',
  });
  assert.equal(result.warnings.length, 0);
  bundled = result.outputFiles[0].text;
  let failed = 0;
  for (const [name, run] of tests) {
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`); }
  }
  console.log(`${tests.length - failed}/${tests.length} statistics UI groups passed`);
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
