// Reads and updates the household's Alexa shopping list.
//
// Amazon has no official API for this since July 2024, so this uses the
// open source alexa-remote2 library, which signs in the way the Alexa app does.
// The sign-in ("cookie") is created once with `npm run alexa-login` and then
// refreshed automatically; each refresh is saved to DATA_DIR/alexa-cookie.json.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function amazonOptions(env = process.env) {
  // Amazon.ca accounts sign in through amazon.com (only Japan uses its own
  // sign-in site), while the shopping list itself lives on amazon.ca.
  const page = env.AMAZON_PAGE || 'amazon.ca';
  const language = env.AMAZON_LANGUAGE || 'en-US';
  return {
    amazonPage: page,
    baseAmazonPage: env.AMAZON_BASE_PAGE || 'amazon.com',
    acceptLanguage: language,
    amazonPageProxyLanguage: language.replace('-', '_'),
  };
}

const promisify = (fn) => new Promise((resolve, reject) => fn((err, res) => (err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve(res))));

export class AlexaList {
  constructor({ dataDir, env = process.env, logger = () => {} }) {
    this.cookieFile = path.join(dataDir, 'alexa-cookie.json');
    this.env = env;
    this.logger = logger;
    this.status = 'not-configured';
    this.error = null;
    this.listId = null;
    this.alexa = null;
  }

  loadCookie() {
    if (fs.existsSync(this.cookieFile)) return JSON.parse(fs.readFileSync(this.cookieFile, 'utf8'));
    if (this.env.ALEXA_COOKIE) {
      // First start on a new server: seed from the secret printed by `npm run alexa-login`.
      const data = JSON.parse(Buffer.from(this.env.ALEXA_COOKIE, 'base64').toString('utf8'));
      this.saveCookie(data);
      return data;
    }
    return null;
  }

  saveCookie(data) {
    fs.mkdirSync(path.dirname(this.cookieFile), { recursive: true });
    fs.writeFileSync(this.cookieFile, JSON.stringify(data));
  }

  async start() {
    const cookie = this.loadCookie();
    if (!cookie) {
      this.status = 'not-configured';
      return;
    }
    this.status = 'connecting';
    const Alexa = require('alexa-remote2');
    this.alexa = new Alexa();
    this.alexa.on('cookie', () => {
      if (this.alexa.cookieData) this.saveCookie(this.alexa.cookieData);
    });
    try {
      await promisify((cb) =>
        this.alexa.init(
          {
            cookie,
            ...amazonOptions(this.env),
            proxyOnly: true,
            useWsMqtt: false,
            usePushConnection: false,
            logger: this.env.ALEXA_DEBUG ? this.logger : undefined,
          },
          cb,
        ),
      );
      this.status = 'ok';
      this.error = null;
    } catch (err) {
      this.status = 'error';
      this.error = `Could not sign in to Alexa: ${err.message}. Run "npm run alexa-login" again.`;
      this.logger(this.error);
    }
  }

  async shoppingListId() {
    if (this.listId) return this.listId;
    const lists = await promisify((cb) => this.alexa.getListsV2(cb));
    const shop = (lists || []).find((l) => l.listType === 'SHOP') || (lists || []).find((l) => /shop/i.test(l.listName || ''));
    if (!shop) throw new Error('No Alexa shopping list found on this account');
    this.listId = shop.listId;
    return this.listId;
  }

  // Every item on the list, ticked or not, as Amazon returns it.
  async allItems() {
    if (this.status !== 'ok') throw new Error(this.error || 'Alexa is not connected');
    const listId = await this.shoppingListId();
    // Amazon rejects page sizes over 100 (despite its error text saying 200),
    // and alexa-remote2 turns that rejection into an empty result. Active items
    // come first, so one page of 100 covers any realistic list.
    const items = await promisify((cb) => this.alexa.getListItemsV2(listId, { limit: 100 }, cb));
    if (!Array.isArray(items)) throw new Error('Amazon did not return the list items');
    return items;
  }

  // Active (not yet completed) items: [{ id, name, version }]
  async getItems() {
    return (await this.allItems())
      .filter((i) => i.itemStatus !== 'COMPLETE')
      .map((i) => ({ id: i.itemId, name: i.itemName, version: i.version }));
  }

  // Ticks an item off in Alexa (done = true) or puts it back (done = false),
  // the same as tapping it in the Alexa app. Amazon needs the item's current
  // version, so it is read fresh each time.
  async setDone(id, done) {
    const current = (await this.allItems()).find((i) => i.itemId === id);
    if (!current) throw new Error('Item is no longer on the Alexa list');
    const status = done ? 'COMPLETE' : 'ACTIVE';
    if (current.itemStatus === status) return;
    const listId = await this.shoppingListId();
    const request = {
      method: 'PUT',
      data: JSON.stringify({
        itemAttributesToUpdate: [{ type: 'itemStatus', value: status }],
        itemAttributesToRemove: [],
      }),
    };
    const url = `https://www.${this.alexa._options.amazonPage}/alexashoppinglists/api/v2/lists/${listId}/items/${encodeURIComponent(id)}?version=${current.version}`;
    const res = await promisify((cb) => this.alexa.httpsGet(url, cb, request));
    if (res && res.errorMessage) throw new Error(res.errorMessage);
  }
}
