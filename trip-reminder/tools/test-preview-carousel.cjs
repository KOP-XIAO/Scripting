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
  const hooks = [], pending = [];
  let cursor = 0, dirty = false, tree, props;
  const native = new Proxy({
    useObservable(initial) {
      const index = cursor++;
      if (!(index in hooks)) {
        let value = typeof initial === 'function' ? initial() : initial;
        hooks[index] = { get value() { return value; }, set value(next) { if (next !== value) { value = next; dirty = true; } } };
      }
      return hooks[index];
    },
    useEffect(callback, deps) {
      const index = cursor++, previous = hooks[index];
      if (!previous || deps.some((value, i) => value !== previous[i])) { hooks[index] = deps; pending.push(callback); }
    },
  }, { get: (target, key) => key in target ? target[key] : key });
  const context = { module: { exports: {} }, __jsx: (type, values, ...children) => ({ type, props: { ...values, children } }), require: () => native };
  vm.runInNewContext(code, context);
  const { TripPreviewCarousel, THEMES } = context.module.exports;
  props = { trips, theme: THEMES.ticket, passengerMode: 'masked', hideSeatNumber: true, now: 12345 };
  const render = changes => {
    props = { ...props, ...changes };
    for (let attempt = 0; attempt < 5; attempt++) {
      cursor = 0; dirty = false; tree = TripPreviewCarousel(props);
      while (pending.length) pending.shift()();
      if (!dirty) return tree;
    }
    throw Error('carousel selection did not settle');
  };
  const nodes = (value = tree) => Array.isArray(value) ? value.flatMap(nodes) : value && value.type && value.props
    ? [value, ...nodes(value.props.children)] : [];
  const one = type => { const found = nodes().filter(node => node.type === type); assert.equal(found.length, 1, `expected one ${type}`); return found[0]; };
  const counter = value => assert.ok(nodes().some(node => node.type === 'Text' && node.props.children.join('') === value), `missing counter ${value}`);
  render();
  return { render, nodes, one, counter, get props() { return props; }, get tree() { return tree; } };
}
const trips = [
  { id: 'first', code: 'G1001', mode: 'rail' },
  { id: 'second', code: 'CA1002', mode: 'flight' },
  { id: 'third', code: 'G1003', mode: 'rail' },
];
let count = 0;
function test(name, run) { run(); console.log(`PASS ${++count}: ${name}`); }
test('native pager swipes and the draggable slider share stable trip selection and the visible counter', () => {
  const f = fixture(trips), pager = f.one('TabView');
  f.counter('1/3');
  assert.equal(pager.props.tabViewStyle, 'page');
  assert.deepEqual(f.nodes().filter(node => node.type === 'Tab').map(node => node.props.value), trips.map(trip => trip.id));
  pager.props.selection.value = 'second'; f.render();
  f.counter('2/3'); assert.equal(f.one('Slider').props.value, 2);
  f.one('Slider').props.onChanged(3); f.render();
  f.counter('3/3'); assert.equal(f.one('TabView').props.selection.value, 'third');
  const slider = f.one('Slider');
  assert.deepEqual([slider.props.min, slider.props.max, slider.props.step], [1, 3, 1]);
  assert.equal(slider.props.accessibilityLabel, '切换预览行程');
});
test('reordering retains the selected trip and removal returns to a valid page without an out-of-range counter', () => {
  const f = fixture(trips);
  f.one('Slider').props.onChanged(2); f.render();
  f.render({ trips: [trips[1], trips[2], trips[0]] });
  f.counter('1/3'); assert.equal(f.one('TabView').props.selection.value, 'second');
  f.render({ trips: [trips[2], trips[0]] });
  f.counter('1/2'); assert.equal(f.one('TabView').props.selection.value, 'third');
  f.one('Slider').props.onChanged(2); f.render(); f.counter('2/2');
  f.render({ trips: [trips[0], trips[2], { id: 'new', code: 'D1004', mode: 'rail' }] });
  f.counter('1/3'); assert.equal(f.one('TabView').props.selection.value, 'first');
});
test('one or no trip hides pagination while forwarding privacy and theme settings unchanged', () => {
  const f = fixture(trips);
  const cards = f.nodes().filter(node => typeof node.type === 'function');
  assert.equal(cards.length, 3);
  for (const [index, card] of cards.entries()) {
    assert.equal(card.props.trip, trips[index]);
    assert.equal(card.props.hideSeatNumber, true); assert.equal(card.props.passengerMode, 'masked');
    assert.equal(card.props.theme, f.props.theme); assert.equal(card.props.now, 12345);
  }
  f.render({ trips: [trips[1]] });
  assert.equal(f.nodes().some(node => node.type === 'Slider' || node.type === 'TabView'), false);
  assert.equal(f.tree.props.trip, trips[1]);
  f.render({ trips: [] }); assert.equal(f.tree, null);
  f.render({ trips: [trips[2], trips[0]] }); f.counter('1/2');
  assert.equal(f.one('TabView').props.selection.value, 'third');
});
test('dragging clamps and rounds page values, ignores invalid input and has no storage side effects', () => {
  const f = fixture(trips);
  for (const [value, expected] of [[99, 3], [-10, 1], [2.4, 2]]) {
    f.one('Slider').props.onChanged(value); f.render(); f.counter(`${expected}/3`);
  }
  for (const value of [NaN, Infinity, -Infinity]) {
    f.one('Slider').props.onChanged(value); f.render(); f.counter('2/3');
  }
});
console.log(`${count}/${count} preview carousel groups passed`);
