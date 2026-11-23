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
