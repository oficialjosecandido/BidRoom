#!/usr/bin/env node
/**
 * Publica um listing na Página de Facebook (e, opcionalmente, no Instagram).
 *
 *   node scripts/post-listing.js                    → escolhe o listing ativo mais recente, só mostra
 *   node scripts/post-listing.js --slug=<slug>      → escolhe um listing específico
 *   node scripts/post-listing.js --post             → publica no Facebook
 *   node scripts/post-listing.js --post --instagram → publica também no Instagram
 *
 * Sem --post não sai nada para fora: compõe a mensagem e mostra-a, para se
 * poder rever o texto antes de ir para uma página pública.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const PAGE_ID = (process.env.FB_PAGE_ID || '').trim();
const PAGE_TOKEN = (process.env.FB_PAGE_ACCESS_TOKEN || '').trim();
const IG_USER_ID = (process.env.IG_USER_ID || '').trim();
const { publicBaseUrl } = require('../src/utils/publicUrls');

const FRONTEND = publicBaseUrl();

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * fetch + json com repetição.
 *
 * Montar um carrossel são dezenas de chamadas seguidas e basta uma ligação
 * cair ("fetch failed") para se perder o trabalho todo. Só se repete o erro de
 * rede: uma resposta da Graph API, mesmo com erro, é devolvida a quem chamou,
 * que é quem sabe interpretá-la.
 */
async function graphFetch(url, init, attempts = 4) {
  for (let i = 1; ; i++) {
    try {
      return await (await fetch(url, init)).json();
    } catch (err) {
      if (i >= attempts) throw err;
      console.log(`   ↻ rede falhou (${err.message}); a repetir ${i}/${attempts - 1}…`);
      await sleep(1000 * i);
    }
  }
}

function arg(name) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const euro = n => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(n || 0);

const EXCERPT_MAX = 180;

/**
 * Excerto em português, sempre.
 *
 * As contas são portuguesas, por isso o post é em PT mesmo quando o anúncio foi
 * escrito noutra língua — nesse caso descriptionPt traz o original e é melhor
 * mostrá-lo do que não mostrar nada. Cortado no fim de uma frase quando possível,
 * para não terminar a meio de uma palavra.
 */
function buildExcerpt(listing) {
  const raw = String(listing.descriptionPt || listing.description || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!raw) return null;
  if (raw.length <= EXCERPT_MAX) return raw;

  const cut = raw.slice(0, EXCERPT_MAX);
  // Prefere cortar num fim de frase; se não houver, no último espaço.
  const sentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (sentenceEnd > EXCERPT_MAX * 0.5) return cut.slice(0, sentenceEnd + 1);

  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : EXCERPT_MAX).trim()}…`;
}

/** Composição do texto do post. É isto que aparece no feed. */
function buildMessage(listing) {
  const url = `${FRONTEND}/listing/${listing.slug}`;
  const title = listing.titlePt || listing.title;
  const ends = new Date(listing.endDate).toLocaleString('pt-PT', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const lines = [`🔨 ${title}`];

  const excerpt = buildExcerpt(listing);
  if (excerpt) lines.push('', excerpt);

  lines.push('', `Licitação atual: ${euro(listing.currentPrice)}`);

  if (listing.buyNowPrice) lines.push(`Compra já: ${euro(listing.buyNowPrice)}`);
  lines.push(`Termina: ${ends}`);
  lines.push('', `Licita em ${url}`);
  lines.push('', '#BidRoom #leiloes #Portugal');

  return lines.join('\n');
}

async function pickListing() {
  const Listing = require('../src/models/Listing');
  const slug = arg('slug');

  const query = slug
    ? { slug }
    : { status: 'active', images: { $exists: true, $ne: [] }, endDate: { $gt: new Date() } };

  const listing = await Listing.findOne(query)
    .sort(slug ? undefined : { createdAt: -1 })
    .select('title titlePt description descriptionPt slug currentPrice buyNowPrice endDate images status')
    .lean();

  if (!listing) {
    fail(slug ? `Não existe listing com slug "${slug}".` : 'Nenhum listing ativo com imagens.');
  }
  return listing;
}

async function postToFacebook(listing, message) {
  // Post com link: o Facebook vai buscar a imagem e o título às tags OG que o
  // backend serve em /listing/:slug, por isso não é preciso enviar a imagem.
  const data = await graphFetch(`${GRAPH}/${PAGE_ID}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      link: `${FRONTEND}/listing/${listing.slug}`,
      access_token: PAGE_TOKEN
    })
  });
  if (data.error) fail(`Facebook — ${data.error.message}`);

  console.log(`\n✅ Facebook: https://facebook.com/${data.id}`);
}

/** Espera que o container fique FINISHED. Devolve false e explica se falhar. */
async function waitForContainer(containerId, attempts = 12, delayMs = 2500) {
  for (let i = 0; i < attempts; i++) {
    const url = new URL(`${GRAPH}/${containerId}`);
    url.searchParams.set('fields', 'status_code,status');
    url.searchParams.set('access_token', PAGE_TOKEN);

    const { status_code: code, status, error } = await graphFetch(url);
    if (error) {
      console.log(`⚠️  Instagram — ${error.message}`);
      return false;
    }
    if (code === 'FINISHED') return true;
    if (code === 'ERROR') {
      console.log(`⚠️  Instagram — o container falhou: ${status || 'sem detalhe'}`);
      return false;
    }
    await sleep(delayMs);
  }
  console.log('⚠️  Instagram — o container não ficou pronto a tempo.');
  return false;
}

/** Limite da API: um carrossel aceita entre 2 e 10 itens. */
const IG_CAROUSEL_MAX = 10;

/** Cria um container de media e devolve o id, ou null com o motivo impresso. */
async function createIgContainer(payload) {
  const data = await graphFetch(`${GRAPH}/${IG_USER_ID}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, access_token: PAGE_TOKEN })
  });
  if (data.error) {
    console.log(`⚠️  Instagram — ${data.error.message}`);
    return null;
  }
  return data.id;
}

/**
 * Monta um carrossel: um container por imagem (is_carousel_item), e depois um
 * container pai que os agrupa e leva a legenda.
 *
 * Cada filho é processado de forma assíncrona e tem de estar FINISHED antes de
 * o pai ser criado — caso contrário a API aceita o pai e falha na publicação.
 *
 * Os filhos são criados em série de propósito. Criá-los em paralelo devolve um
 * id para cada um e todos chegam a FINISHED, mas o carrossel publicado sai com
 * menos itens do que os pedidos, sem erro em lado nenhum. Em série sai completo.
 */
async function createCarousel(images, caption) {
  console.log(`   A preparar ${images.length} imagens…`);

  const childIds = [];
  for (const [i, url] of images.entries()) {
    process.stdout.write(`   imagem ${i + 1}/${images.length}… `);
    const id = await createIgContainer({ image_url: url, is_carousel_item: true });
    if (!id) {
      console.log('⚠️  Instagram — imagem recusada; carrossel abortado.');
      return null;
    }
    if (!await waitForContainer(id)) {
      console.log('⚠️  Instagram — imagem não ficou pronta; carrossel abortado.');
      return null;
    }
    childIds.push(id);
    console.log('pronta');
  }

  return createIgContainer({
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption
  });
}

async function postToInstagram(listing, message) {
  if (!IG_USER_ID) return console.log('⏭️  IG_USER_ID em falta — Instagram ignorado.');

  const images = (listing.images || []).filter(u => /^https:\/\//.test(u));
  if (images.length === 0) {
    return console.log('⚠️  Instagram ignorado: nenhuma imagem com URL https público.');
  }

  const selected = images.slice(0, IG_CAROUSEL_MAX);
  if (images.length > IG_CAROUSEL_MAX) {
    console.log(`ℹ️  ${images.length} imagens — o Instagram só aceita ${IG_CAROUSEL_MAX}, as restantes ficam de fora.`);
  }

  // Um carrossel precisa de pelo menos dois itens; com uma imagem só, o post
  // tem de ser simples ou a API rejeita-o.
  const parentId = selected.length >= 2
    ? await createCarousel(selected, message)
    : await createIgContainer({ image_url: selected[0], caption: message });

  if (!parentId) return;

  // O container é processado de forma assíncrona: publicar antes de estar
  // FINISHED devolve "Media ID is not available". É preciso esperar.
  const ready = await waitForContainer(parentId);
  if (!ready) return;

  const posted = await graphFetch(`${GRAPH}/${IG_USER_ID}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: parentId, access_token: PAGE_TOKEN })
  });
  if (posted.error) return console.log(`⚠️  Instagram — ${posted.error.message}`);

  await reportPublished(posted.id, selected.length);
}

/**
 * Lê o post publicado e confirma que levou todas as imagens.
 *
 * A API perde itens de um carrossel sem devolver erro, por isso o número de
 * imagens enviadas não é prova de nada — só o que está publicado conta.
 */
async function reportPublished(mediaId, expected) {
  const url = new URL(`${GRAPH}/${mediaId}`);
  url.searchParams.set('fields', 'media_type,permalink,children{id}');
  url.searchParams.set('access_token', PAGE_TOKEN);

  const media = await graphFetch(url);
  if (media.error) {
    return console.log(`✅ Instagram: post ${mediaId} (não foi possível confirmar: ${media.error.message})`);
  }

  const actual = media.media_type === 'CAROUSEL_ALBUM'
    ? (media.children?.data || []).length
    : 1;

  console.log(`✅ Instagram: ${media.permalink || mediaId}`);
  console.log(`   ${actual}/${expected} imagens publicadas${actual < expected ? ' ⚠️' : ''}`);
}

/** Nome da base de dados do MONGO_URI, ou null se o URI não for legível. */
function databaseName(uri) {
  try {
    return new URL(String(uri).replace(/^mongodb(\+srv)?:/, 'https:')).pathname.slice(1) || null;
  } catch {
    return null;
  }
}

async function main() {
  if (!PAGE_ID || !PAGE_TOKEN) fail('FB_PAGE_ID ou FB_PAGE_ACCESS_TOKEN em falta no .env.');
  if (!process.env.MONGO_URI) fail('MONGO_URI em falta no .env.');
  if (/localhost|127\.0\.0\.1/.test(FRONTEND)) {
    fail(`O link social aponta para ${FRONTEND}. Define SOCIAL_PUBLIC_URL ou FRONTEND_URL_PROD.`);
  }

  // As contas de Facebook e Instagram são as reais e públicas — não há versão de
  // testes delas. O .env local aponta para bidroom-dev, por isso, sem esta
  // barreira, um anúncio de teste sai para os seguidores como se fosse a sério.
  // --allow-dev-data existe para quando se quer mesmo fazer um teste público.
  const db = databaseName(process.env.MONGO_URI);
  const looksLikeDev = db && /dev|test|staging|local/i.test(db);
  if (looksLikeDev && process.argv.includes('--post') && !process.argv.includes('--allow-dev-data')) {
    fail(
      `A base de dados é "${db}" mas as contas sociais são as públicas reais.\n` +
      '   Aponta o MONGO_URI para produção, ou acrescenta --allow-dev-data para publicar mesmo assim.'
    );
  }
  if (looksLikeDev) console.log(`⚠️  Dados de "${db}" — base de dados de desenvolvimento.`);

  await mongoose.connect(process.env.MONGO_URI);
  const listing = await pickListing();
  await mongoose.disconnect();

  const message = buildMessage(listing);

  console.log(`Listing: ${listing.title} (${listing.status})`);
  console.log(`Imagens: ${listing.images?.length || 0} (o Instagram leva até ${IG_CAROUSEL_MAX} em carrossel)`);
  console.log('\n--- post ---');
  console.log(message);
  console.log('------------');

  if (!process.argv.includes('--post')) {
    console.log('\nNada publicado. Para publicar: --post (acrescenta --instagram para o IG)');
    return;
  }

  // --instagram-only evita republicar no Facebook ao repetir um teste do IG.
  const igOnly = process.argv.includes('--instagram-only');
  if (!igOnly) await postToFacebook(listing, message);
  if (igOnly || process.argv.includes('--instagram')) await postToInstagram(listing, message);
  console.log('\n⚠️  Posts de teste ficam públicos. Apaga-os quando terminares.');
}

main().catch(err => fail(err.message));
