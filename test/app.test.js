import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { State } from '../src/state.js';

const layout = JSON.parse(fs.readFileSync(new URL('../config/store-layout.json', import.meta.url)));

class FakeAlexa {
  constructor(items) {
    this.status = 'ok';
    this.error = null;
    this.items = items;
    this.done = new Set();
    this.calls = [];
  }
  async getItems() { return this.items.filter((i) => !this.done.has(i.id)); }
  async setDone(id, done) {
    this.calls.push([id, done]);
    if (done) this.done.add(id);
    else this.done.delete(id);
  }
}

let server, base, dir, alexa, state;

async function start(passcode = '') {
  const app = createApp({ layout, state, alexa, passcode });
  server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
}

const get = (p, headers) => fetch(base + p, { headers }).then(async (r) => ({ status: r.status, body: await r.json(), headers: r.headers }));
const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json(), headers: r.headers }));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-'));
  state = new State(dir);
  alexa = new FakeAlexa([
    { id: 'a1', name: 'Milk', version: 1 },
    { id: 'a2', name: 'peanut butter', version: 3 },
    { id: 'a3', name: 'flux capacitor', version: 1 },
  ]);
});
afterEach(() => { server?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('list comes back sorted by location', async () => {
  await start();
  const { body } = await get('/api/list');
  const byName = Object.fromEntries(body.items.map((i) => [i.name, i.locationId]));
  assert.equal(byName.Milk, 'dairy');
  assert.equal(byName['flux capacitor'], 'unsorted');
  assert.equal(body.locations[0].id, 'unsorted');
  assert.equal(body.locations[1].id, 'meat');
});

test('moving an item is remembered for next time', async () => {
  await start();
  assert.equal((await post('/api/items/a2/move', { locationId: 'aisle-5' })).status, 200);
  const { body } = await get('/api/list');
  const pb = body.items.find((i) => i.id === 'a2');
  assert.equal(pb.locationId, 'aisle-5');
  assert.equal(pb.how, 'learned');
  // Saved to disk, so it survives a restart.
  assert.equal(new State(dir).corrections['peanut butter'], 'aisle-5');
});

test('moving to an unknown location is refused', async () => {
  await start();
  assert.equal((await post('/api/items/a2/move', { locationId: 'nope' })).status, 400);
});

test('crossing off ticks the item in Alexa straight away', async () => {
  await start();
  const res = await post('/api/items/a1/check', { checked: true });
  assert.deepEqual(res.body, { ok: true, synced: true });
  assert.deepEqual(alexa.calls, [['a1', true]]);
  // Still shown, crossed out, until "Done shopping".
  let { body } = await get('/api/list?refresh=1');
  assert.equal(body.items.find((i) => i.id === 'a1').checked, true);

  const fin = await post('/api/finish', {});
  assert.deepEqual(fin.body, { done: 1, failed: [] });
  assert.deepEqual(alexa.calls, [['a1', true]]);
  ({ body } = await get('/api/list?refresh=1'));
  assert.equal(body.items.find((i) => i.id === 'a1'), undefined);
});

test('unchecking puts the item back on the Alexa list', async () => {
  await start();
  await post('/api/items/a1/check', { checked: true });
  await post('/api/items/a1/check', { checked: false });
  assert.deepEqual(alexa.calls, [['a1', true], ['a1', false]]);
  assert.equal(alexa.done.has('a1'), false);
  const { body } = await get('/api/list?refresh=1');
  assert.equal(body.items.find((i) => i.id === 'a1').checked, false);
});

test('pasted items are added, sorted and cleared on finish', async () => {
  alexa.status = 'not-configured';
  await start();
  const res = await post('/api/paste', { text: '- bananas\n2 dish soap\n\n' });
  assert.equal(res.body.added, 2);
  let { body } = await get('/api/list');
  const bananas = body.items.find((i) => i.name === 'bananas');
  assert.equal(bananas.locationId, 'produce');
  assert.equal(bananas.source, 'manual');
  await post(`/api/items/${bananas.id}/check`, { checked: true });
  await post('/api/finish', {});
  ({ body } = await get('/api/list'));
  assert.deepEqual(body.items.map((i) => i.name), ['dish soap']);
});

test('a tick that cannot reach Alexa is kept and sent on "Done shopping"', async () => {
  await start();
  const realSetDone = alexa.setDone.bind(alexa);
  alexa.setDone = async () => { throw new Error('no signal'); };
  const res = await post('/api/items/a1/check', { checked: true });
  assert.deepEqual(res.body, { ok: true, synced: false });
  let { body } = await get('/api/list');
  assert.equal(body.items.find((i) => i.id === 'a1').checked, true);

  // Still offline: finishing reports it and keeps it crossed off.
  let fin = await post('/api/finish', {});
  assert.deepEqual(fin.body, { done: 0, failed: ['Milk'] });

  alexa.setDone = realSetDone;
  fin = await post('/api/finish', {});
  assert.deepEqual(fin.body, { done: 1, failed: [] });
  assert.equal(alexa.done.has('a1'), true);
});

test('passcode is required when set', async () => {
  await start('carrots');
  assert.equal((await get('/api/list')).status, 401);
  assert.equal((await post('/api/login', { passcode: 'wrong' })).status, 401);
  const ok = await post('/api/login', { passcode: 'carrots' });
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.equal((await get('/api/list', { cookie })).status, 200);
});
