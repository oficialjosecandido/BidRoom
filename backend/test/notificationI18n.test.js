const fs = require('fs');
const path = require('path');

/**
 * In-app notifications are localized when they are READ, not when they are
 * written: the backend stores an `i18nKey` plus the values to interpolate, and
 * the client renders the text from the catalogue the rest of the UI uses.
 *
 * That splits one message across two repositories, so nothing at runtime fails
 * loudly when they drift — ngx-translate echoes a missing key back and the pipe
 * quietly falls back to the stored English. These tests are the join: every key
 * the backend names has to exist, in every language, with the same placeholders.
 */

const LANGUAGES = ['en', 'pt', 'es', 'fr'];
const I18N_DIR = path.join(__dirname, '..', '..', 'frontend', 'public', 'i18n');
const SERVICE_DIR = path.join(__dirname, '..', 'src');

const catalogues = Object.fromEntries(
  LANGUAGES.map(lang => [
    lang,
    JSON.parse(fs.readFileSync(path.join(I18N_DIR, `${lang}.json`), 'utf8'))
  ])
);

/** Resolve a dotted catalogue path, or null when any segment is missing. */
function lookup(doc, dotted) {
  let node = doc;
  for (const segment of dotted.split('.')) {
    if (!node || typeof node !== 'object' || !(segment in node)) return null;
    node = node[segment];
  }
  return node;
}

/** Every leaf string under a node, by dotted path. */
function leaves(node, prefix = '') {
  if (typeof node === 'string') return [[prefix, node]];
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

/** Every .js file under src, so a new notifier anywhere is covered. */
function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

const sources = sourceFiles(SERVICE_DIR).map(file => ({
  file: path.relative(SERVICE_DIR, file),
  text: fs.readFileSync(file, 'utf8')
}));

/** Keys written out in full: `i18nKey: 'notifications.newBid'`. */
function literalKeys() {
  const found = new Map();
  for (const { file, text } of sources) {
    for (const match of text.matchAll(/'(notifications\.[A-Za-z0-9]+(?:\.[A-Za-z0-9_]+)*)'/g)) {
      if (!found.has(match[1])) found.set(match[1], file);
    }
  }
  return found;
}

/**
 * Keys built by a helper: `standIn('yourListing')` becomes
 * `notifications.standIn.yourListing`. A template literal with `${}` in it
 * cannot be resolved statically, so the helpers' own definitions are excluded
 * and only their call sites are read.
 */
function helperKeys() {
  const found = new Map();
  const helpers = [
    [/\bstandIn\('([A-Za-z0-9_]+)'\)/g, 'notifications.standIn.'],
  ];
  for (const { file, text } of sources) {
    for (const [pattern, prefix] of helpers) {
      for (const match of text.matchAll(pattern)) {
        const key = prefix + match[1];
        if (!found.has(key)) found.set(key, file);
      }
    }
  }
  return found;
}

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

describe('in-app notification catalogue', () => {
  const referenced = literalKeys();
  const standIns = helperKeys();

  it('finds the keys the backend references', () => {
    // A guard on the scan itself: if the regexes stop matching, every
    // assertion below would pass over an empty set.
    expect(referenced.size).toBeGreaterThan(60);
    expect(standIns.size).toBeGreaterThan(10);
  });

  it('has every referenced notifier key in all four languages', () => {
    for (const [key, file] of referenced) {
      for (const lang of LANGUAGES) {
        const node = lookup(catalogues[lang], key);
        expect(node).not.toBeNull();
        // A notifier key names a title/message pair; a parameter key
        // (standIn.*, shipping.*) resolves to a string.
        if (node && typeof node === 'object') {
          expect(Object.keys(node).sort()).toEqual(['message', 'title']);
          expect(typeof node.title).toBe('string');
          expect(typeof node.message).toBe('string');
        } else {
          expect(typeof node).toBe('string');
        }
        expect(`${lang}:${key} (from ${file})`).toBeTruthy();
      }
    }
  });

  it('has every stand-in a notifier asks for in all four languages', () => {
    for (const [key] of standIns) {
      for (const lang of LANGUAGES) {
        expect(typeof lookup(catalogues[lang], key)).toBe('string');
      }
    }
  });

  it('interpolates the same placeholders in every language', () => {
    // A placeholder present in one language and not another loses a value —
    // an amount, a name, an address — for the readers of that language only.
    for (const [key, text] of leaves(catalogues.en.notifications, 'notifications')) {
      const expected = [...text.matchAll(PLACEHOLDER)].map(m => m[1]).sort();
      for (const lang of LANGUAGES.slice(1)) {
        const other = lookup(catalogues[lang], key);
        expect(typeof other).toBe('string');
        const actual = [...String(other).matchAll(PLACEHOLDER)].map(m => m[1]).sort();
        expect({ key, lang, actual }).toEqual({ key, lang, actual: expected });
      }
    }
  });

  it('leaves no placeholder unclosed', () => {
    for (const lang of LANGUAGES) {
      for (const [key, text] of leaves(catalogues[lang].notifications, 'notifications')) {
        const opens = (text.match(/\{\{/g) || []).length;
        const closes = (text.match(/\}\}/g) || []).length;
        expect({ lang, key, opens, closes }).toEqual({ lang, key, opens, closes: opens });
      }
    }
  });

  it('writes money the same way everywhere', () => {
    // pt.json already put the symbol before the number throughout, so one
    // format string works in all four languages and no notifier has to know
    // the reader's money layout.
    for (const lang of LANGUAGES) {
      for (const [key, text] of leaves(catalogues[lang].notifications, 'notifications')) {
        if (!text.includes('€')) continue;
        expect({ lang, key, trailing: /\d\s*€/.test(text) })
          .toEqual({ lang, key, trailing: false });
      }
    }
  });
});

describe('Portuguese register', () => {
  // Two notifiers used to be hardcoded Portuguese in informal *tu* with AO90
  // spelling — a third register, in the one language most of the marketplace
  // reads. The catalogue is the house register: formal, pre-AO90.
  const AO90_OR_BRAZILIAN = [
    'você', 'vocês', 'usuário', 'senha', 'celular', 'transação', 'transações',
    'receção', 'seleção', 'proteção', 'ação', 'ações', 'atual', 'ativo',
    'ativos', 'ativa', 'ativas', 'atividade', 'atividades', 'contato'
  ];
  // A possessive takes the definite article in pt-PT ("a sua conta"); bare
  // "sua conta" is the Brazilian form.
  const ARTICLES = new Set([
    'o', 'a', 'os', 'as', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas',
    'ao', 'aos', 'à', 'às', 'pelo', 'pela', 'pelos', 'pelas', 'nosso', 'nossa'
  ]);

  const pt = leaves(catalogues.pt.notifications, 'notifications');

  it('uses pt-PT spelling', () => {
    for (const [key, text] of pt) {
      for (const word of AO90_OR_BRAZILIAN) {
        const hit = new RegExp(`\\b${word}\\b`, 'i').test(text);
        expect({ key, word, hit }).toEqual({ key, word, hit: false });
      }
    }
  });

  it('puts the article before every possessive', () => {
    for (const [key, text] of pt) {
      for (const match of text.matchAll(/\b(seu|sua|seus|suas)\b/gi)) {
        // Non-letter is spelled out rather than left to `\W`, which in
        // JavaScript is ASCII-only and would count the `à` of "à sua conta"
        // as a separator — swallowing the very article being checked for.
        const before = text.slice(0, match.index).match(/([A-Za-zÀ-ÿ]+)[^A-Za-zÀ-ÿ]+$/);
        const ok = !!before && ARTICLES.has(before[1].toLowerCase());
        expect({ key, possessive: match[0], ok }).toEqual({ key, possessive: match[0], ok: true });
      }
    }
  });

  it('is no longer hardcoded in any notifier', () => {
    // The stored title/message are the English fallback by contract; the two
    // notifiers that wrote Portuguese straight into the database bypassed the
    // catalogue entirely, so neither language could be served from one place.
    const service = sources.find(s => s.file === path.join('services', 'notificationService.js'));
    expect(service).toBeDefined();
    for (const word of ['Confirma quando receberes', 'Tens anúncios', 'configuraste']) {
      expect(service.text).not.toContain(word);
    }
  });
});
