import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { AlexaList } from '../src/alexa.js';

function connected(getListItemsV2) {
  const list = new AlexaList({ dataDir: os.tmpdir(), env: {} });
  list.status = 'ok';
  list.listId = 'shop-1';
  list.alexa = { getListItemsV2 };
  return list;
}

test('asks Amazon for at most 100 items and returns only active ones', async () => {
  let asked;
  const list = connected((id, opts, cb) => {
    asked = opts.limit;
    cb(null, [
      { itemId: '1', itemName: 'ice cream', itemStatus: 'ACTIVE', version: 2 },
      { itemId: '2', itemName: 'old milk', itemStatus: 'COMPLETE', version: 5 },
    ]);
  });
  assert.deepEqual(await list.getItems(), [{ id: '1', name: 'ice cream', version: 2 }]);
  assert.ok(asked <= 100);
});

test('a missing item list is an error, not an empty list', async () => {
  const list = connected((id, opts, cb) => cb(null, undefined));
  await assert.rejects(list.getItems(), /did not return/);
});

test('an empty list is fine', async () => {
  const list = connected((id, opts, cb) => cb(null, []));
  assert.deepEqual(await list.getItems(), []);
});

function withItems(items, puts) {
  const list = connected((id, opts, cb) => cb(null, items));
  list.alexa._options = { amazonPage: 'amazon.ca' };
  list.alexa.httpsGet = (url, cb, req) => { puts.push({ url, body: JSON.parse(req.data), method: req.method }); cb(null, {}); };
  return list;
}

test('setDone sends the new status with the item\'s current version', async () => {
  const puts = [];
  const list = withItems([{ itemId: 'x1', itemName: 'milk', itemStatus: 'ACTIVE', version: 7 }], puts);
  await list.setDone('x1', true);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].method, 'PUT');
  assert.match(puts[0].url, /lists\/shop-1\/items\/x1\?version=7$/);
  assert.deepEqual(puts[0].body.itemAttributesToUpdate, [{ type: 'itemStatus', value: 'COMPLETE' }]);
});

test('setDone can put a ticked item back, and skips no-op changes', async () => {
  const puts = [];
  const list = withItems([{ itemId: 'x1', itemName: 'milk', itemStatus: 'COMPLETE', version: 8 }], puts);
  await list.setDone('x1', true);
  assert.equal(puts.length, 0);
  await list.setDone('x1', false);
  assert.deepEqual(puts[0].body.itemAttributesToUpdate, [{ type: 'itemStatus', value: 'ACTIVE' }]);
});

test('setDone fails for an item that is gone', async () => {
  const list = withItems([], []);
  await assert.rejects(list.setDone('nope', true), /no longer on the Alexa list/);
});
