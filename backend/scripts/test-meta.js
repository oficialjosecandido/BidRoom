#!/usr/bin/env node
/**
 * Verifica a ligação à Graph API da Meta (Página de Facebook + conta Instagram).
 *
 *   node scripts/test-meta.js          → só valida os tokens, não publica nada
 *   node scripts/test-meta.js --post   → publica mesmo um post de teste na Página
 *
 * A publicação está atrás da flag de propósito: o post vai para a Página real e
 * fica visível para toda a gente. Validar o token não precisa de publicar nada.
 */

require('dotenv').config();

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Preenchido a partir de /me quando FB_PAGE_ID não está no .env. */
let PAGE_ID = process.env.FB_PAGE_ID;
const PAGE_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const IG_USER_ID = process.env.IG_USER_ID;

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

/** A Graph API devolve 200 com um objeto `error` em alguns casos — verifica sempre. */
async function graph(path, params = {}) {
  const url = new URL(`${GRAPH}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('access_token', PAGE_TOKEN);

  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    throw new Error(`${data.error.type} ${data.error.code}: ${data.error.message}`);
  }
  return data;
}

async function checkPage() {
  const page = await graph(`/${PAGE_ID}`, { fields: 'name,fan_count,link' });
  console.log(`✅ Página: ${page.name} (${page.fan_count ?? '?'} seguidores)`);
  console.log(`   ${page.link || `https://facebook.com/${PAGE_ID}`}`);
}

async function identify() {
  const me = await graph('/me', { fields: 'id,name' });

  if (!PAGE_ID) {
    PAGE_ID = me.id;
    console.log(`ℹ️  FB_PAGE_ID não definido — resolvido de /me: ${PAGE_ID}`);
    console.log('   Acrescenta-o ao .env para não depender desta resolução.');
  }

  const isPageToken = String(me.id) === String(PAGE_ID);
  console.log(`✅ Token pertence a: ${me.name} (${isPageToken ? 'token de Página' : '⚠️  token de UTILIZADOR, não de Página'})`);
}

/**
 * Um token de Página não permite introspeção de permissões: /me/permissions e
 * o campo `tasks` só existem em contexto de utilizador, e debug_token exige o
 * app secret. Resta sondar os endpoints que interessam e ver se respondem.
 */
/**
 * Confirma que o token não expira. Um token de Página derivado de um token de
 * utilizador de longa duração vem sem expiração; um derivado de um token curto
 * expira em ~1h e a automação deixa de funcionar sem aviso.
 */
async function checkTokenExpiry() {
  const appId = process.env.FB_APP_ID;
  const appSecret = process.env.FB_APP_SECRET;
  if (!appId || !appSecret) {
    console.log('⏭️  FB_APP_ID/FB_APP_SECRET em falta — validade do token não verificada.');
    return;
  }

  const url = new URL(`${GRAPH}/debug_token`);
  url.searchParams.set('input_token', PAGE_TOKEN);
  url.searchParams.set('access_token', `${appId}|${appSecret}`);

  const res = await fetch(url);
  const { data, error } = await res.json();
  if (error || !data) {
    console.log(`⚠️  Não foi possível inspecionar o token — ${error?.message || 'resposta vazia'}`);
    return;
  }

  if (!data.is_valid) {
    console.log('❌ O token está INVÁLIDO segundo a Meta.');
    return;
  }

  // expires_at 0 (ou ausente) = nunca expira.
  if (!data.expires_at) {
    console.log('✅ Token permanente (não expira).');
  } else {
    const when = new Date(data.expires_at * 1000);
    const days = Math.round((when - Date.now()) / 86400000);
    console.log(`⚠️  Token EXPIRA em ${when.toLocaleString('pt-PT')} (${days} dia(s)).`);
  }

  console.log(`   Permissões: ${(data.scopes || []).join(', ') || 'nenhuma'}`);
}

async function checkFeedRead() {
  try {
    const { data = [] } = await graph(`/${PAGE_ID}/feed`, { limit: '1', fields: 'id,created_time' });
    const last = data[0];
    console.log(`✅ Leitura do feed OK${last ? ` — último post: ${new Date(last.created_time).toLocaleString('pt-PT')}` : ' — feed vazio'}`);
  } catch (err) {
    console.log(`⚠️  Leitura do feed falhou — ${err.message}`);
    console.log('   Falta provavelmente pages_read_engagement.');
  }
}

async function checkInstagram() {
  if (!IG_USER_ID) {
    console.log('⏭️  IG_USER_ID não definido — Instagram ignorado.');
    return;
  }
  const ig = await graph(`/${IG_USER_ID}`, { fields: 'username,followers_count' });
  console.log(`✅ Instagram: @${ig.username} (${ig.followers_count ?? '?'} seguidores)`);
}

async function publishTestPost() {
  const res = await fetch(`${GRAPH}/${PAGE_ID}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: '🚀 Teste de automação — Novo leilão BidRoom!',
      access_token: PAGE_TOKEN
    })
  });
  const data = await res.json();
  if (data.error) fail(`Publicação falhou — ${data.error.message}`);

  console.log(`\n✅ Post publicado: ${data.id}`);
  console.log(`   https://facebook.com/${data.id}`);
  console.log('   ⚠️  Está público. Apaga-o na Página quando terminares o teste.');
}

async function main() {
  if (!PAGE_TOKEN) fail('FB_PAGE_ACCESS_TOKEN não está definido no .env.');

  console.log(`Graph API ${GRAPH_VERSION}\n`);

  try {
    // Antes de checkPage, que precisa do id resolvido.
    await identify();
    await checkPage();
    await checkTokenExpiry();
    await checkFeedRead();
    await checkInstagram();
  } catch (err) {
    fail(`Validação falhou — ${err.message}`);
  }

  if (process.argv.includes('--post')) {
    await publishTestPost();
  } else {
    console.log('\n✅ Tokens válidos. Nada foi publicado.');
    console.log('   Para publicar mesmo: node scripts/test-meta.js --post');
  }
}

main();
