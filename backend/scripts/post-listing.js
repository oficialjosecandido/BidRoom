#!/usr/bin/env node
/**
 * Publica um listing na Página de Facebook (e, opcionalmente, no Instagram).
 *
 *   node scripts/post-listing.js                    → escolhe o listing ativo mais recente, só mostra
 *   node scripts/post-listing.js --slug=<slug>      → escolhe um listing específico
 *   node scripts/post-listing.js --post             → publica no Facebook
 *   node scripts/post-listing.js --post --instagram → publica também no Instagram
 *   node scripts/post-listing.js --post --instagram-only → só Instagram
 *
 * Sem --post não sai nada para fora: compõe a mensagem e mostra-a, para se
 * poder rever o texto antes de ir para uma página pública.
 *
 * Com SOCIAL_AUTOPOST=true o backend já publica sozinho quando um anúncio é
 * aprovado no Nexus (ver src/services/socialPublisherService.js), e cada anúncio
 * tem botões de Facebook e Instagram no Nexus para republicar. Este script fica
 * para testes a partir da linha de comandos — o que publica não fica registado
 * no anúncio, por isso o Nexus não o vê. Uma rede onde o anúncio já foi
 * publicado é ignorada, a não ser com --repost.
 *
 * Só se publica o que já foi aprovado no Nexus — ver assertPublishable().
 */

require('dotenv').config();
const mongoose = require('mongoose');

const { publicBaseUrl } = require('../src/utils/publicUrls');
const {
  IG_CAROUSEL_MAX,
  buildMessage,
  publishableImages,
  postToFacebook,
  postToInstagram,
  nonProductionDatabase
} = require('../src/services/socialPublisherService');

const FRONTEND = publicBaseUrl();

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

function arg(name) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const flag = name => process.argv.includes(`--${name}`);

async function pickListing() {
  const Listing = require('../src/models/Listing');
  const slug = arg('slug');

  const query = slug
    ? { slug }
    : { status: 'active', images: { $exists: true, $ne: [] }, endDate: { $gt: new Date() } };

  const listing = await Listing.findOne(query)
    .sort(slug ? undefined : { createdAt: -1 })
    .select('title titlePt description descriptionPt slug saleFormat currentPrice buyNowPrice endDate images status moderationReview +socialPosts')
    .lean();

  if (!listing) {
    fail(slug ? `Não existe listing com slug "${slug}".` : 'Nenhum listing ativo com imagens.');
  }
  return listing;
}

/** Porque é que um anúncio não pode ir para as redes, na língua de quem lê. */
const NAO_PUBLICAVEL = {
  pending_review: 'ainda está à espera de aprovação no Nexus',
  draft: 'ainda é um rascunho',
  cancelled: 'foi cancelado ou rejeitado na revisão',
  ended: 'já terminou'
};

/**
 * Um anúncio só vai para as redes sociais depois de aprovado.
 *
 * `active` é exatamente essa prova: desde a revisão manual, o único caminho para
 * `active` passa por uma aprovação no Nexus. Não se exige
 * `moderationReview.decision === 'approved'` porque os anúncios que já estavam
 * publicados antes desta funcionalidade não têm decisão registada e continuam
 * legitimamente no ar — exigi-la deixava-os de fora sem razão.
 *
 * A barreira existe sobretudo por causa de --slug, que escolhe o anúncio pelo
 * nome e não passa pelo filtro de estado da consulta por omissão.
 */
function assertPublishable(listing) {
  if (listing.status !== 'active') {
    fail(
      `"${listing.slug}" ${NAO_PUBLICAVEL[listing.status] || `está em "${listing.status}"`}.\n` +
      '   Só se publica nas redes sociais depois de o anúncio ser aprovado.'
    );
  }

  // Aprovado e no ar, mas com o relógio já passado: o post levaria seguidores a
  // um leilão onde não podem licitar. Acontece entre o fim e a passagem do
  // scheduler, por isso é aviso, não barreira.
  if (listing.endDate && new Date(listing.endDate) <= new Date()) {
    console.log('⚠️  O leilão já passou da data de fim — o post apontaria para um leilão fechado.');
  }
}

/** O que a publicação automática já deixou registado, numa linha por rede. */
function describeSocialPosts(listing) {
  const { facebook, instagram } = listing.socialPosts || {};
  const line = (nome, post, id) => {
    if (post?.status === 'publishing') return `   ${nome}: a publicar desde ${new Date(post.startedAt).toISOString()}`;
    if (post?.status === 'failed') {
      return `   ${nome}: falhou — ${post.error}${post.postedAt ? ` (publicado antes: ${id})` : ''}`;
    }
    if (post?.postedAt) return `   ${nome}: publicado (${id})`;
    return `   ${nome}: nada registado`;
  };
  return [
    line('Facebook', facebook, facebook?.postId),
    line('Instagram', instagram, instagram?.permalink || instagram?.mediaId)
  ].join('\n');
}

async function main() {
  if (!process.env.FB_PAGE_ID || !process.env.FB_PAGE_ACCESS_TOKEN) {
    fail('FB_PAGE_ID ou FB_PAGE_ACCESS_TOKEN em falta no .env.');
  }
  if (!process.env.MONGO_URI) fail('MONGO_URI em falta no .env.');
  if (/localhost|127\.0\.0\.1/.test(FRONTEND)) {
    fail(`O link social aponta para ${FRONTEND}. Define SOCIAL_PUBLIC_URL ou FRONTEND_URL_PROD.`);
  }

  // As contas de Facebook e Instagram são as reais e públicas — não há versão de
  // testes delas. O .env local aponta para bidroom-dev, por isso, sem esta
  // barreira, um anúncio de teste sai para os seguidores como se fosse a sério.
  // --allow-dev-data existe para quando se quer mesmo fazer um teste público.
  const db = nonProductionDatabase();
  if (db && flag('post') && !flag('allow-dev-data')) {
    fail(
      `A base de dados é "${db}" mas as contas sociais são as públicas reais.\n` +
      '   Aponta o MONGO_URI para produção, ou acrescenta --allow-dev-data para publicar mesmo assim.'
    );
  }
  if (db) console.log(`⚠️  Dados de "${db}" — base de dados de desenvolvimento.`);

  await mongoose.connect(process.env.MONGO_URI);
  const listing = await pickListing();
  await mongoose.disconnect();

  const message = buildMessage(listing);

  const decisao = listing.moderationReview?.decision;
  console.log(`Listing: ${listing.title} (${listing.status}${decisao ? `, ${decisao}` : ''})`);
  console.log(`Imagens: ${publishableImages(listing).length} (o Instagram leva até ${IG_CAROUSEL_MAX} em carrossel)`);
  console.log(`Redes sociais:\n${describeSocialPosts(listing)}`);
  console.log('\n--- post ---');
  console.log(message);
  console.log('------------');

  if (!flag('post')) {
    // A pré-visualização continua a funcionar em qualquer estado de propósito:
    // dá jeito ler o texto do post enquanto se decide se o anúncio é aprovado.
    if (listing.status !== 'active') {
      console.log(`\n⛔ ${NAO_PUBLICAVEL[listing.status] || `está em "${listing.status}"`} — --post seria recusado.`);
    }
    console.log('\nNada publicado. Para publicar: --post (acrescenta --instagram para o IG)');
    return;
  }

  assertPublishable(listing);

  // --instagram-only evita republicar no Facebook ao repetir um teste do IG.
  const igOnly = flag('instagram-only');
  const alreadyPosted = platform => Boolean(listing.socialPosts?.[platform]?.postedAt) && !flag('repost');

  if (!igOnly) {
    if (alreadyPosted('facebook')) {
      console.log('\n⏭️  Facebook: já publicado — ignorado (--repost para publicar outra vez).');
    } else {
      try {
        const { postId } = await postToFacebook(listing, message);
        console.log(`\n✅ Facebook: https://facebook.com/${postId}`);
      } catch (err) {
        console.log(`\n⚠️  ${err.message}`);
      }
    }
  }

  if (igOnly || flag('instagram')) {
    if (alreadyPosted('instagram')) {
      console.log('⏭️  Instagram: já publicado — ignorado (--repost para publicar outra vez).');
    } else if (!process.env.IG_USER_ID) {
      console.log('⏭️  IG_USER_ID em falta — Instagram ignorado.');
    } else {
      try {
        console.log('   A preparar o Instagram…');
        const { mediaId, permalink, imagesSent, imageCount } = await postToInstagram(listing, message, {
          onImageReady: (n, total) => console.log(`   imagem ${n}/${total} pronta`)
        });
        console.log(`✅ Instagram: ${permalink || mediaId}`);
        if (imageCount === null) {
          console.log('   (não foi possível confirmar quantas imagens ficaram publicadas)');
        } else {
          console.log(`   ${imageCount}/${imagesSent} imagens publicadas${imageCount < imagesSent ? ' ⚠️' : ''}`);
        }
      } catch (err) {
        console.log(`⚠️  ${err.message}`);
      }
    }
  }

  console.log('\n⚠️  Posts de teste ficam públicos. Apaga-os quando terminares.');
}

main().catch(err => fail(err.message));
