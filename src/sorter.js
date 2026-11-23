// Decides which store location (aisle or area) an item belongs to.
//
// Order of precedence:
//   1. A correction the family made in the app ("learned").
//   2. The longest layout keyword found in the item name ("keyword").
//   3. Otherwise the item is "unsorted".

export const UNSORTED_ID = 'unsorted';

const UNITS = new Set([
  'x', 'kg', 'g', 'lb', 'lbs', 'oz', 'l', 'ml', 'litre', 'litres', 'liter', 'liters',
  'pack', 'packs', 'bag', 'bags', 'box', 'boxes', 'can', 'cans', 'bottle', 'bottles',
  'dozen', 'jar', 'jars', 'tub', 'tubs', 'carton', 'cartons',
]);

// Plural forms we keep as-is, because stripping the "s" makes a different word.
const KEEP = new Set(['chips', 'nuts', 'oats', 'peas', 'beans', 'molasses', 'hummus', 'couscous', 'asparagus', 'swiss', 'grits', 'greens']);

function singular(word) {
  if (word.length <= 3 || KEEP.has(word)) return word;
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('oes')) return word.slice(0, -2);
  if (word.endsWith('ches') || word.endsWith('shes') || word.endsWith('xes')) return word.slice(0, -2);
  if (word.endsWith('ss') || word.endsWith('us')) return word;
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

// "2 bags of Frozen Peas!" -> "frozen peas"
export function normalize(name) {
  const words = String(name)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .replace(/['-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !/^\d+([.,]\d+)?(kg|g|lb|lbs|oz|l|ml|pk|x)?$/.test(w))
    .filter((w) => !UNITS.has(w));
  // Drop a leading "of" left over from "2 bags of ...".
  while (words[0] === 'of' || words[0] === 'some' || words[0] === 'a' || words[0] === 'an') words.shift();
  return words.map(singular).join(' ').trim();
}

export class Sorter {
  constructor(layout, corrections = {}) {
    this.layout = layout;
    this.corrections = corrections;
    this.locationIds = new Set(layout.locations.map((l) => l.id));
    this.keywords = [];
    for (const loc of layout.locations) {
      for (const kw of loc.keywords || []) {
        const n = normalize(kw);
        if (n) this.keywords.push({ phrase: ` ${n} `, length: n.length, locationId: loc.id });
      }
    }
    // Longest first, so "ice cream" beats "cream".
    this.keywords.sort((a, b) => b.length - a.length);
  }

  locate(name) {
    const key = normalize(name);
    const learned = this.corrections[key];
    if (learned && this.locationIds.has(learned)) return { locationId: learned, how: 'learned', key };
    const padded = ` ${key} `;
    for (const kw of this.keywords) {
      if (padded.includes(kw.phrase)) return { locationId: kw.locationId, how: 'keyword', key };
    }
    return { locationId: UNSORTED_ID, how: 'unsorted', key };
  }
}
