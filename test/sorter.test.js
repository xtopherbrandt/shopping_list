import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Sorter, normalize } from '../src/sorter.js';

const layout = JSON.parse(fs.readFileSync(new URL('../config/store-layout.json', import.meta.url)));

test('normalize strips quantities, units and plurals', () => {
  assert.equal(normalize('2 bags of Frozen Peas!'), 'frozen peas');
  assert.equal(normalize('Bananas'), 'banana');
  assert.equal(normalize('1L milk'), 'milk');
  assert.equal(normalize('Tomatoes'), 'tomato');
  assert.equal(normalize('berries'), 'berry');
  assert.equal(normalize('chips'), 'chips');
  assert.equal(normalize('Mac & Cheese'), 'mac and cheese');
});

test('items sort by layout keywords', () => {
  const s = new Sorter(layout);
  const where = (name) => s.locate(name).locationId;
  assert.equal(where('dish soap'), 'aisle-1');
  assert.equal(where('Toilet paper'), 'aisle-2');
  assert.equal(where('tortilla chips'), 'aisle-3');
  assert.equal(where('spaghetti'), 'aisle-6');
  assert.equal(where('ketchup'), 'aisle-8');
  assert.equal(where('milk'), 'dairy');
  assert.equal(where('bananas'), 'produce');
  assert.equal(where('tuna'), 'near-produce');
  assert.equal(where('ground beef'), 'meat');
});

test('longest keyword wins', () => {
  const s = new Sorter(layout);
  assert.equal(s.locate('ice cream').locationId, 'aisle-7');
  assert.equal(s.locate('whipping cream').locationId, 'dairy');
});

test('unknown items are unsorted', () => {
  const s = new Sorter(layout);
  assert.deepEqual(s.locate('flux capacitor'), { locationId: 'unsorted', how: 'unsorted', key: 'flux capacitor' });
});

test('saved corrections win over keywords and match plural forms', () => {
  const s = new Sorter(layout, { 'peanut butter': 'aisle-5' });
  assert.equal(s.locate('peanut butter').locationId, 'aisle-5');
  assert.equal(s.locate('Peanut Butter').how, 'learned');
  assert.notEqual(new Sorter(layout).locate('peanut butter').locationId, 'aisle-5');
});

test('a correction to a location that no longer exists is ignored', () => {
  const s = new Sorter(layout, { milk: 'aisle-99' });
  assert.equal(s.locate('milk').locationId, 'dairy');
});
