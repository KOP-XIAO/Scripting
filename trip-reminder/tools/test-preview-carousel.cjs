#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const ROOT = path.resolve(__dirname, '..');
const code = esbuild.buildSync({
  stdin: { contents: 'export { TripPreviewCarousel } from "./components/trip-preview-carousel"; export { THEMES } from "./services/theme";', resolveDir: ROOT, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false, external: ['scripting'], jsxFactory: '__jsx',
}).outputFiles[0].text;
function fixture(trips) {
  const native = new Proxy({}, { get: (_, key) => key });
  const context = { module: { exports: {} }, __jsx: (type, values, ...children) => ({ type, props: { ...values, children } }), require: () => native };
  vm.runInNewContext(code, context);
  const { TripPreviewCarousel, THEMES } = context.module.exports;
  let props = { trips, theme: THEMES.ticket, passengerMode: 'masked', hideSeatNumber: true, now: 12345 }, tree;
  const render = changes => { props = { ...props, ...changes }; tree = TripPreviewCarousel(props); return tree; };
  const nodes = (value = tree) => Array.isArray(value) ? value.flatMap(nodes) : value && value.type && value.props
    ? [value, ...nodes(value.props.children)] : [];
  const one = type => { const found = nodes().filter(node => node.type === type); assert.equal(found.length, 1, `expected one ${type}`); return found[0]; };
  render();
  return { render, nodes, one, get props() { return props; }, get tree() { return tree; } };
}
const trips = [
  { id: 'first', code: 'G1001', mode: 'rail' },
  { id: 'second', code: 'CA1002', mode: 'flight' },
  { id: 'third', code: 'G1003', mode: 'rail' },
];
function assertPageCounters(f, expected) {
  const pager = f.one('TabView');
  assert.equal(pager.props.tabViewStyle, 'page');
  assert.equal(pager.props.selection, undefined, 'ordinary native page views must not use the unsupported modern Tab selection composition');
  const pages = pager.props.children.flat(Infinity);
  assert.equal(pages.length, expected.length);
  pages.forEach((page, index) => {
    assert.equal(page.type, 'VStack');
    assert.equal(page.props.key, expected[index].id);
    const cards = f.nodes(page).filter(node => typeof node.type === 'function');
    assert.equal(cards.length, 1);
    assert.equal(cards[0].props.trip, expected[index]);
    const counter = f.nodes(page).find(node => node.type === 'Text' && /^第 /.test(node.props.accessibilityLabel || ''));
    assert.ok(counter, 'each actual card page must own its counter, rather than an independent value outside the pager');
    assert.equal(counter.props.children.join(''), `${index + 1}/${expected.length}`);
    assert.equal(counter.props.accessibilityLabel, `第 ${index + 1} 条行程，共 ${expected.length} 条`);
  });
}
let count = 0;
function test(name, run) { run(); console.log(`PASS ${++count}: ${name}`); }
test('each ordinary native page owns the matching card and its own current-page counter', () => {
  const f = fixture(trips);
  assertPageCounters(f, trips);
  assert.equal(f.nodes().some(node => node.type === 'Tab'), false);
});
test('the lower cue is a small passive line with no slider or independent interaction state', () => {
  const f = fixture(trips);
  const cue = f.one('RoundedRectangle');
  assert.equal(cue.props.frame.width, 32);
  assert.equal(cue.props.frame.height, 3);
  assert.equal(cue.props.accessibilityHidden, true);
  assert.equal(f.tree.props.children.flat(Infinity).at(-1), cue, 'cue follows the pager');
  assert.equal(f.nodes().some(node => ['Slider', 'Button'].includes(node.type)), false);
  for (const node of f.nodes()) {
    assert.equal(node.props.onChanged, undefined);
    assert.equal(node.props.onTapGesture, undefined);
    assert.equal(node.props.onDrag, undefined);
  }
});
test('reordering, deleting and appending rebuild correct page-local counters without a stale external selection', () => {
  const f = fixture(trips);
  const reordered = [trips[1], trips[2], trips[0]];
  f.render({ trips: reordered }); assertPageCounters(f, reordered);
  const remaining = [trips[2], trips[0]];
  f.render({ trips: remaining }); assertPageCounters(f, remaining);
  const appended = [...remaining, { id: 'new', code: 'D1004', mode: 'rail' }];
  f.render({ trips: appended }); assertPageCounters(f, appended);
});
test('one or no trip hides the cue while cards retain privacy and theme settings', () => {
  const f = fixture(trips);
  for (const [index, card] of f.nodes().filter(node => typeof node.type === 'function').entries()) {
    assert.equal(card.props.trip, trips[index]);
    assert.equal(card.props.hideSeatNumber, true); assert.equal(card.props.passengerMode, 'masked');
    assert.equal(card.props.theme, f.props.theme); assert.equal(card.props.now, 12345);
  }
  f.render({ trips: [trips[1]] });
  assert.equal(f.nodes().some(node => ['Slider', 'TabView', 'RoundedRectangle'].includes(node.type)), false);
  assert.equal(f.tree.props.trip, trips[1]);
  f.render({ trips: [] }); assert.equal(f.tree, null);
  f.render({ trips: [trips[2], trips[0]] }); assertPageCounters(f, [trips[2], trips[0]]);
});
console.log(`${count}/${count} preview carousel groups passed`);
