import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sorter, UNSORTED_ID, normalize } from './sorter.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const CACHE_MS = 20_000;

// alexa: an object with { status, error, getItems(), complete(item) } (see alexa.js)
// state: a State (see state.js)
export function createApp({ layout, state, alexa, passcode = '', storeName = '' }) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  // --- Family passcode -----------------------------------------------------
  const token = passcode ? crypto.createHash('sha256').update(`shopping-list:${passcode}`).digest('hex') : '';
  const cookieToken = (req) => (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith('sl_auth='))?.slice(8);

  app.post('/api/login', (req, res) => {
    if (!passcode) return res.json({ ok: true });
    const given = String(req.body?.passcode || '');
    if (given !== passcode) return res.status(401).json({ error: 'Wrong passcode' });
    res.setHeader('Set-Cookie', `sl_auth=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`);
    res.json({ ok: true });
  });

  app.use('/api', (req, res, next) => {
    if (!passcode || cookieToken(req) === token) return next();
    res.status(401).json({ error: 'Passcode needed' });
  });

  // --- Alexa items, cached briefly so every tap doesn't call Amazon ---------
  let cache = { at: 0, items: [], error: null };
  async function alexaItems(force = false) {
    if (alexa.status !== 'ok') return { items: [], error: alexa.status === 'not-configured' ? null : alexa.error };
    if (!force && Date.now() - cache.at < CACHE_MS) return cache;
    try {
      cache = { at: Date.now(), items: await alexa.getItems(), error: null };
    } catch (err) {
      cache = { at: Date.now(), items: cache.items, error: `Couldn't read the Alexa list: ${err.message}` };
    }
    return cache;
  }

  async function currentItems(force = false) {
    const fromAlexa = await alexaItems(force);
    const items = [
      ...fromAlexa.items.map((i) => ({ ...i, source: 'alexa' })),
      ...state.data.manualItems.map((i) => ({ ...i, source: 'manual' })),
    ];
    // Items crossed off this trip that Alexa no longer lists still show, crossed out.
    const ids = new Set(items.map((i) => i.id));
    for (const [id, c] of Object.entries(state.data.checked)) {
      if (!ids.has(id)) items.push({ id, name: c.name, source: c.source, version: c.version });
    }
    return { items, error: fromAlexa.error };
  }

  function locations() {
    return [
      { id: UNSORTED_ID, name: 'Not sorted yet', subtitle: 'Tap ⋯ to pick where it is' },
      ...layout.locations.map(({ id, name, subtitle, signs }) => ({ id, name, subtitle, signs })),
    ];
  }

  app.get('/api/list', async (req, res) => {
    const { items, error } = await currentItems(req.query.refresh === '1');
    const sorter = new Sorter(layout, state.corrections);
    res.json({
      store: storeName || layout.store,
      alexa: { status: alexa.status, error: error || alexa.error || null },
      locations: locations(),
      items: items.map((i) => {
        const where = sorter.locate(i.name);
        return { id: i.id, name: i.name, source: i.source, checked: Boolean(state.data.checked[i.id]), locationId: where.locationId, how: where.how };
      }),
    });
  });

  async function findItem(id) {
    const { items } = await currentItems();
    return items.find((i) => i.id === id);
  }

  app.post('/api/items/:id/check', async (req, res) => {
    const item = await findItem(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    state.setChecked(item, Boolean(req.body?.checked));
    res.json({ ok: true });
  });

  app.post('/api/items/:id/move', async (req, res) => {
    const locationId = String(req.body?.locationId || '');
    if (!layout.locations.some((l) => l.id === locationId)) return res.status(400).json({ error: 'Unknown location' });
    const item = await findItem(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    state.setCorrection(normalize(item.name), locationId);
    res.json({ ok: true });
  });

  app.post('/api/paste', (req, res) => {
    const lines = String(req.body?.text || '').split(/\r?\n|,/);
    const added = state.addManualItems(lines);
    res.json({ added: added.length });
  });

  // End of trip: tick crossed-off items in Alexa and clear them from the app.
  app.post('/api/finish', async (req, res) => {
    const checked = Object.entries(state.data.checked);
    const fresh = checked.some(([, c]) => c.source === 'alexa') ? await alexaItems(true) : { items: [] };
    const active = new Map(fresh.items.map((i) => [i.id, i]));
    const failed = [];
    let done = 0;
    for (const [id, c] of checked) {
      try {
        if (c.source === 'alexa' && active.has(id)) await alexa.complete(active.get(id));
        if (c.source === 'manual') state.removeManualItem(id);
        delete state.data.checked[id];
        done += 1;
      } catch (err) {
        failed.push(c.name);
      }
    }
    state.save();
    cache.at = 0;
    res.json({ done, failed });
  });

  app.use(express.static(PUBLIC_DIR));
  return app;
}
