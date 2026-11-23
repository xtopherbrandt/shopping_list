// Small JSON file store for everything the app learns or tracks:
//   corrections  normalized item name -> location id (saved when you move an item)
//   manualItems  items added with "Paste list" (backup for when Alexa is unreachable)
//   checked      item id -> { name, source, synced } crossed off during the current trip
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const EMPTY = () => ({ corrections: {}, manualItems: [], checked: {} });

export class State {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'state.json');
    fs.mkdirSync(dataDir, { recursive: true });
    this.data = EMPTY();
    if (fs.existsSync(this.file)) {
      this.data = { ...EMPTY(), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    }
  }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get corrections() {
    return this.data.corrections;
  }

  setCorrection(key, locationId) {
    if (!key) return;
    this.data.corrections[key] = locationId;
    this.save();
  }

  addManualItems(names) {
    const added = [];
    for (const raw of names) {
      const name = raw.replace(/^[\s\-*••\d.)]+/, '').trim();
      if (!name) continue;
      const item = { id: `m_${crypto.randomUUID()}`, name };
      this.data.manualItems.push(item);
      added.push(item);
    }
    this.save();
    return added;
  }

  removeManualItem(id) {
    this.data.manualItems = this.data.manualItems.filter((i) => i.id !== id);
  }

  // synced: false when the tick couldn't be sent to Alexa yet.
  setChecked(item, checked, synced = true) {
    if (checked) this.data.checked[item.id] = { name: item.name, source: item.source, synced };
    else delete this.data.checked[item.id];
    this.save();
  }
}
