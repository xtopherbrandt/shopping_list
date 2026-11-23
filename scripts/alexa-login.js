// One-time Alexa sign-in. Run on your own computer:
//
//   npm run alexa-login
//
// then open http://localhost:3001 and sign in to Amazon (amazon.ca by default).
// The sign-in is saved to data/alexa-cookie.json, and a one-line secret is
// printed for the cloud server (see README, "Connect Alexa").
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { amazonOptions } from '../src/alexa.js';

const require = createRequire(import.meta.url);
const Alexa = require('alexa-remote2');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const PORT = Number(process.env.PROXY_PORT || 3001);

const alexa = new Alexa();
console.log(`\nOpen http://localhost:${PORT} in your browser and sign in to Amazon.\n`);

alexa.init(
  {
    ...amazonOptions(),
    proxyOnly: true,
    proxyOwnIp: 'localhost',
    proxyPort: PORT,
    proxyLogLevel: 'warn',
    useWsMqtt: false,
    usePushConnection: false,
    cookieRefreshInterval: 0,
  },
  (err) => {
    if (err) {
      // While waiting for you to sign in, alexa-remote2 reports the proxy URL as an "error".
      if (/localhost:\d+/.test(String(err.message || err))) return;
      console.error('Sign-in failed:', err.message || err);
      process.exit(1);
    }
    const data = alexa.cookieData;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, 'alexa-cookie.json'), JSON.stringify(data));
    const secret = Buffer.from(JSON.stringify(data)).toString('base64');
    alexa.getListsV2((e, lists) => {
      const shop = (lists || []).find((l) => l.listType === 'SHOP');
      console.log(`\nSigned in. ${shop ? 'Found your Alexa shopping list.' : 'Warning: no shopping list found yet.'}`);
      console.log(`Saved to ${path.join(DATA_DIR, 'alexa-cookie.json')}.`);
      console.log('\nFor the cloud server, run this (one line):\n');
      console.log(`fly secrets set ALEXA_COOKIE=${secret}\n`);
      process.exit(0);
    });
  },
);
