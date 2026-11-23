import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { State } from './state.js';
import { AlexaList } from './alexa.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const LAYOUT_FILE = process.env.LAYOUT_FILE || path.join(ROOT, 'config', 'store-layout.json');
const PORT = Number(process.env.PORT || 8080);

const layout = JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf8'));
const state = new State(DATA_DIR);
const alexa = new AlexaList({ dataDir: DATA_DIR, logger: console.log });

if (!process.env.APP_PASSCODE) console.warn('APP_PASSCODE is not set: anyone with the link can see and change the list.');

const app = createApp({ layout, state, alexa, passcode: process.env.APP_PASSCODE || '' });
app.listen(PORT, () => console.log(`Shopping list running on http://localhost:${PORT}`));

alexa.start().then(() => console.log(`Alexa: ${alexa.status}${alexa.error ? ` (${alexa.error})` : ''}`));
