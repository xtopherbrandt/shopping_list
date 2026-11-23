(() => {
  const $ = (sel) => document.querySelector(sel);
  const CACHE_KEY = 'shopping-list:last';
  let data = null;
  let moving = null;

  const store = {
    get() { try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; } },
    set(v) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  async function api(path, body) {
    const res = await fetch(path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.status === 401 && path !== '/api/login') { showLogin(); throw new Error('login'); }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    return res.json();
  }

  function banner(text) {
    const el = $('#banner');
    el.hidden = !text;
    el.textContent = text || '';
  }

  async function load(refresh = false) {
    $('#refresh').classList.add('spin');
    try {
      data = await api(`/api/list${refresh ? '?refresh=1' : ''}`);
      store.set(data);
      const a = data.alexa;
      if (a.error) banner(a.error);
      else if (a.status === 'not-configured') banner('Alexa isn\'t connected yet. You can still use "Paste list".');
      else if (a.status === 'connecting') banner('Connecting to Alexa…');
      else banner('');
      render();
      if (a.status === 'connecting') setTimeout(() => load(), 3000);
    } catch (err) {
      if (err.message !== 'login') {
        banner(`Can't reach the server (${err.message}). Showing the last list you loaded.`);
        if (!data) { data = store.get(); if (data) render(); }
      }
    } finally {
      $('#refresh').classList.remove('spin');
    }
  }

  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const k of kids) if (k != null) n.append(k);
    return n;
  }

  function render() {
    $('#store').textContent = data.store || '';
    const main = $('#list');
    main.replaceChildren();
    const total = data.items.length;
    const done = data.items.filter((i) => i.checked).length;
    $('#progress').textContent = total ? `${done} of ${total} in the basket` : '';

    if (!total) {
      main.append(el('p', { class: 'muted center' }, 'The list is empty. Add things by saying "Alexa, add milk to my shopping list."'));
      return;
    }
    for (const loc of data.locations) {
      const items = data.items.filter((i) => i.locationId === loc.id);
      if (!items.length) continue;
      // Crossed-off items sink to the bottom of their group.
      items.sort((a, b) => Number(a.checked) - Number(b.checked) || a.name.localeCompare(b.name));
      main.append(el('section', { class: `group ${loc.id === 'unsorted' ? 'unsorted' : ''}` },
        el('div', { class: 'group-head' }, el('h3', {}, loc.name), loc.subtitle ? el('span', { class: 'sub' }, loc.subtitle) : null),
        el('ul', { class: 'items' }, ...items.map(itemRow)),
      ));
    }
  }

  function itemRow(item) {
    return el('li', { class: `item ${item.checked ? 'done' : ''}` },
      el('button', { class: 'check', onclick: () => toggle(item), 'aria-pressed': String(item.checked) },
        el('span', { class: 'box', 'aria-hidden': 'true' }, '✓'),
        el('span', { class: 'name' }, item.name, item.source === 'manual' ? el('span', { class: 'tag' }, 'pasted') : null),
      ),
      el('button', { class: 'more', onclick: () => openMove(item), 'aria-label': `Move ${item.name} to another aisle` }, '⋯'),
    );
  }

  async function toggle(item) {
    item.checked = !item.checked;
    render();
    store.set(data);
    try {
      await api(`/api/items/${encodeURIComponent(item.id)}/check`, { checked: item.checked });
    } catch (err) {
      if (err.message !== 'login') banner(`Couldn't save that tick (${err.message}). Try again when you have signal.`);
    }
  }

  function openMove(item) {
    moving = item;
    $('#move-name').textContent = item.name;
    const opts = $('#move-options');
    opts.replaceChildren(...data.locations.filter((l) => l.id !== 'unsorted').map((loc) =>
      el('button', { class: `option ${loc.id === item.locationId ? 'current' : ''}`, value: loc.id, type: 'button', onclick: () => move(loc.id) },
        loc.name, el('span', { class: 'sub' }, [loc.subtitle, ...(loc.signs || [])].filter(Boolean).join(' · ') || ' '),
      )));
    $('#move').showModal();
  }

  async function move(locationId) {
    $('#move').close();
    const item = moving;
    // Every item with the same name moves too, as the server will sort it that way.
    for (const i of data.items) if (i.name.toLowerCase() === item.name.toLowerCase()) i.locationId = locationId;
    render();
    try {
      await api(`/api/items/${encodeURIComponent(item.id)}/move`, { locationId });
      load();
    } catch (err) {
      if (err.message !== 'login') banner(`Couldn't save the new spot (${err.message}).`);
    }
  }

  async function finish() {
    const done = data?.items.filter((i) => i.checked).length || 0;
    if (!done) { banner('Nothing is crossed off yet.'); return; }
    $('#finish').disabled = true;
    try {
      const res = await api('/api/finish', {});
      banner(res.failed.length ? `Couldn't tick off in Alexa: ${res.failed.join(', ')}. Try "Done shopping" again.` : `Nice! ${res.done} item${res.done === 1 ? '' : 's'} cleared from the list.`);
      await load(true);
    } catch (err) {
      if (err.message !== 'login') banner(`Couldn't finish (${err.message}).`);
    } finally {
      $('#finish').disabled = false;
    }
  }

  function showLogin() {
    if (!$('#login').open) $('#login').showModal();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/login', { passcode: $('#passcode').value });
      $('#login').close();
      load(true);
    } catch {
      $('#login-error').hidden = false;
    }
  });
  $('#login').addEventListener('cancel', (e) => e.preventDefault());

  $('#paste-form').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'add') return;
    const text = $('#paste-text').value;
    if (!text.trim()) return;
    try {
      await api('/api/paste', { text });
      $('#paste-text').value = '';
      load();
    } catch (err) {
      if (err.message !== 'login') banner(`Couldn't add those (${err.message}).`);
    }
  });

  $('#refresh').addEventListener('click', () => load(true));
  $('#finish').addEventListener('click', finish);
  $('#paste-open').addEventListener('click', () => $('#paste').showModal());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

  data = store.get();
  if (data) render();
  load(true);
})();
