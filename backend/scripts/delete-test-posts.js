#!/usr/bin/env node
/**
 * Apaga os posts de teste deixados pelos ensaios da integração com a Meta.
 *
 *   node scripts/delete-test-posts.js           → lista o que seria apagado
 *   node scripts/delete-test-posts.js --delete  → apaga mesmo
 *
 * Sem --delete não apaga nada: apagar é irreversível e os ids são escritos à
 * mão, por isso mostra-se primeiro o que está por trás de cada um.
 */

require('dotenv').config();

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const PAGE_TOKEN = (process.env.FB_PAGE_ACCESS_TOKEN || '').trim();
const PAGE_ID = (process.env.FB_PAGE_ID || '').trim();
const IG_USER_ID = (process.env.IG_USER_ID || '').trim();

/**
 * Ids como vieram da resposta de /feed. O Graph não os aceita nus — lidos assim
 * devolve "singular statuses API is deprecated" — é preciso {página}_{post}.
 */
const FB_POSTS = [
  '122133361749359649',
  '122133362937359649',
  '122133364239359649'
].map(id => (id.includes('_') ? id : `${PAGE_ID}_${id}`));

const DO_DELETE = process.argv.includes('--delete');

async function graphFetch(url, init) {
  return (await fetch(url, init)).json();
}

function withToken(path, fields) {
  const url = new URL(`${GRAPH}/${path}`);
  if (fields) url.searchParams.set('fields', fields);
  url.searchParams.set('access_token', PAGE_TOKEN);
  return url;
}

async function handleFacebook() {
  console.log('\n— Facebook —');
  for (const id of FB_POSTS) {
    const post = await graphFetch(withToken(id, 'id,created_time,message'));
    if (post.error) {
      // Já apagado numa execução anterior, ou nunca existiu: não é um problema.
      console.log(`  ${id}: ${post.error.message}`);
      continue;
    }

    const preview = String(post.message || '').split('\n')[0].slice(0, 60);
    if (!DO_DELETE) {
      console.log(`  ${id}: "${preview}" (${post.created_time})`);
      continue;
    }

    const res = await graphFetch(withToken(id), { method: 'DELETE' });
    console.log(res.error ? `  ${id}: ⚠️  ${res.error.message}` : `  ${id}: apagado`);
  }
}

/**
 * O Instagram não deixa apagar publicações pela API — a Content Publishing API
 * só publica. Listam-se as recentes com o permalink para se apagarem à mão na
 * app, que é o único caminho que existe.
 */
async function handleInstagram() {
  console.log('\n— Instagram —');
  if (!IG_USER_ID) return console.log('  IG_USER_ID em falta.');

  const media = await graphFetch(
    withToken(`${IG_USER_ID}/media`, 'id,media_type,permalink,timestamp,caption')
  );
  if (media.error) return console.log(`  ⚠️  ${media.error.message}`);

  const recent = (media.data || []).slice(0, 10);
  if (recent.length === 0) return console.log('  Sem publicações.');

  for (const m of recent) {
    const preview = String(m.caption || '').split('\n')[0].slice(0, 50);
    console.log(`  ${m.permalink}`);
    console.log(`     ${m.media_type} · ${m.timestamp} · "${preview}"`);
  }
  console.log('\n  A API do Instagram não apaga publicações — só a app/web o faz.');
}

async function main() {
  if (!PAGE_TOKEN) {
    console.error('\n❌ FB_PAGE_ACCESS_TOKEN em falta no .env.\n');
    process.exit(1);
  }

  await handleFacebook();
  await handleInstagram();

  if (!DO_DELETE) console.log('\nNada apagado. Para apagar no Facebook: --delete');
}

main().catch(err => {
  console.error(`\n❌ ${err.message}\n`);
  process.exit(1);
});
