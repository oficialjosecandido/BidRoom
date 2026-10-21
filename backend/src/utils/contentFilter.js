/**
 * Detects contact info (phone numbers, emails, external URLs) in user-provided text.
 * Used to prevent sellers from bypassing the platform by sharing direct contact details.
 */

const PHONE_RE = /(\+?\d[\s\-.]?){8,15}\d/g;

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+\s*@\s*[a-zA-Z0-9.\-]+\s*\.\s*[a-zA-Z]{2,}/g;

// Matches http(s)://, www., or bare domains with common TLDs
const URL_RE = /(?:https?:\/\/|www\.)[^\s,<>"']+|[a-zA-Z0-9\-]+\.(?:com|net|org|io|co|uk|pt|de|fr|es|it|nl|ru|info|biz|me|app|dev)[^\s,<>"']*/gi;

// Obfuscation patterns: "at" / "dot" replacements for email/domain
const OBFUSCATED_EMAIL_RE = /[a-zA-Z0-9._%+\-]+\s+(?:at|@)\s+[a-zA-Z0-9.\-]+\s+(?:dot|\.)\s+[a-zA-Z]{2,}/gi;

/**
 * Scans text for contact info.
 * @param {string} text
 * @returns {{ found: boolean, types: string[] }}
 */
function scanForContactInfo(text) {
  if (!text || typeof text !== 'string') return { found: false, types: [] };

  const types = new Set();

  if (EMAIL_RE.test(text) || OBFUSCATED_EMAIL_RE.test(text)) types.add('email');

  // Reset lastIndex after RegExp.test (stateful global regex)
  EMAIL_RE.lastIndex = 0;
  OBFUSCATED_EMAIL_RE.lastIndex = 0;

  if (URL_RE.test(text)) types.add('url');
  URL_RE.lastIndex = 0;

  // Phone: only flag if it looks intentional (9+ digits, possibly spaced/dashed).
  // Below 9 digits this catches too many false positives (reference numbers, year ranges like "1966-1991").
  const phoneMatches = text.match(PHONE_RE);
  if (phoneMatches && phoneMatches.some(m => m.replace(/\D/g, '').length >= 9)) {
    types.add('phone');
  }

  return { found: types.size > 0, types: [...types] };
}

/**
 * Scans multiple text fields and returns combined result.
 * @param {string[]} texts
 * @returns {{ found: boolean, types: string[] }}
 */
function scanTexts(texts) {
  const allTypes = new Set();
  for (const text of texts) {
    const result = scanForContactInfo(text);
    result.types.forEach(t => allTypes.add(t));
  }
  return { found: allTypes.size > 0, types: [...allTypes] };
}

const CONTACT_INFO_TYPE_LABELS = { phone: 'a phone number', email: 'an email address', url: 'a link to an external website' };

/**
 * Turns ['phone', 'email'] into "a phone number and an email address" so the
 * seller knows exactly what to remove instead of just "contact info".
 * @param {string[]} types
 * @returns {string}
 */
function describeContactInfoTypes(types) {
  const labels = (types || []).map(t => CONTACT_INFO_TYPE_LABELS[t] || t);
  if (labels.length === 0) return 'contact information';
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

// EN + PT profanity (derivatives via \w* where applicable, explicit forms elsewhere)
const ABUSE_RE = /\b(fuck\w*|shit\w*|bitch\w*|asshole|bastard|cunt|nigger\w*|faggot|slut\w*|whore|retard|motherfuck\w*|bullshit\w*|jackass\w*|asshat|dickhead\w*|dipshit\w*|douchebag\w*|son\s*of\s*a\s*bitch|puta|putas|filho\s*da\s*puta|filha\s*da\s*puta|fdp|caralho|merda|porra|viado|bicha|corno|foda\b|fodas\w*|vai\s*se\s*foder|vai\s*[aà]\s*merda|puta\s*merda|puta\s*que\s*pariu|arrombad\w+|babaca\w*|buceta|piroca|desgraçad\w+|canalha|seu\s*lixo)\b/gi;

// EN + PT hate speech
const HATE_RE = /\b(kill\s+all|go\s+back\s+to\s+your\s+country|white\s+power|heil\s+hitler|gas\s+the|race\s+traitor|subhuman|morte\s+a\s+todos\s+os|poder\s+branco|vai\s+para\s+o\s+teu\s+pa[ií]s|vai\s+para\s+o\s+seu\s+pa[ií]s)\b/gi;

/**
 * Normalize text for abusive-content scanning:
 * collapses leet-speak substitutions, removes char separators and repeated
 * chars (3+), and lowercases. Applied before regex matching to catch obfuscated slurs.
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/@/g, 'a')
    .replace(/1/g, 'i')
    .replace(/!/g, 'i')
    .replace(/\$/g, 's')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/\+/g, 't')
    .replace(/\|/g, 'i')
    .replace(/ph/g, 'f')
    // Remove deliberate separators inserted between letters (f.u.c.k → fuck)
    .replace(/([a-z])[\.\-_·*]+(?=[a-z])/g, '$1')
    // Collapse 3+ identical consecutive chars to 1 (fuuuck → fuck, shiiiit → shit)
    .replace(/(.)\1{2,}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score severity of an abusive-content result.
 * - 'low'    : profanity only, 1–2 matches
 * - 'medium' : profanity 3+ matches, OR 1 hate-speech match
 * - 'high'   : 2+ hate-speech matches, OR both profanity and hate-speech
 * @param {{ categories: string[], matches: string[] }} result
 * @returns {'low'|'medium'|'high'|null}
 */
function getAbuseSeverity(result) {
  if (!result.found) return null;
  const hasHate = result.categories.includes('hate_speech');
  const hasProfanity = result.categories.includes('profanity');
  const matchCount = result.matches.length;

  if (hasHate && matchCount >= 2) return 'high';
  if (hasHate && hasProfanity) return 'high';
  if (hasHate) return 'medium';
  if (hasProfanity && matchCount >= 3) return 'medium';
  return 'low';
}

/**
 * Scan text for profanity and hate speech, with leet-speak normalization.
 * Severity is included in the result so callers can apply tiered actions.
 * @param {string} text
 * @returns {{ found: boolean, categories: string[], matches: string[], severity: 'low'|'medium'|'high'|null }}
 */
function scanForAbusiveContent(text) {
  const normalized = normalizeText(text);
  if (!normalized) return { found: false, categories: [], matches: [], severity: null };

  const categories = new Set();
  const matches = new Set();

  const abuseMatches = normalized.match(ABUSE_RE) || [];
  const hateMatches = normalized.match(HATE_RE) || [];

  if (abuseMatches.length) {
    categories.add('profanity');
    abuseMatches.forEach((m) => matches.add(m));
  }
  if (hateMatches.length) {
    categories.add('hate_speech');
    hateMatches.forEach((m) => matches.add(m));
  }

  const result = {
    found: categories.size > 0,
    categories: [...categories],
    matches: [...matches]
  };
  result.severity = getAbuseSeverity(result);
  return result;
}

/**
 * Policy keyword filter for the public "Artigos proibidos e restritos" policy,
 * in PT, EN, ES and FR.
 *
 * This does NOT refuse a listing. Every listing is created as `pending_review`
 * and an admin approves it in Nexus, so a match only rides along on
 * `moderationWarning.policyCategory` to tell the reviewer where to look. The
 * decision is a person's; this just points.
 *
 * That makes a false positive cheap — a second of a reviewer's attention rather
 * than a lost sale — but not free, so the rules still demand context instead of
 * bare keywords, because a filter that cries wolf gets ignored:
 *
 *   - "ivory" and "marfim" are colours far more often than they are elephant
 *     (the seed data alone has an "ivory wool rug"), so the ivory rule needs a
 *     tusk, a carving or the animal named.
 *   - "pele" is Portuguese for leather; "bone china", "French horn",
 *     "tortoiseshell frames", "cadeira empalhada" and "pistola de cola" are all
 *     legitimate listings.
 *   - "revolver" is a Beatles record, "granada" is a garnet, "AAA" is a
 *     battery, and "espadas" is a suit of playing cards.
 *
 * `unless`, when present, is tested against the whole text and vetoes the
 * match.
 *
 * Restricted-but-allowed items (exotic skins with CITES papers, antiquities
 * with provenance, precious-metal hallmarks, high-value identity checks) are
 * deliberately absent — they are conditions for a reviewer to verify against
 * documents, not keywords a regex can settle.
 */
const PROHIBITED_PATTERNS = [
  {
    category: 'Counterfeit or replica goods',
    // The policy bans replicas of branded goods even when the listing is honest
    // about it. "Replica" on its own is not enough to refuse on: a resin
    // swordfish trophy, a museum reproduction and a 1:18 die-cast model are all
    // honestly-described replicas of nothing anyone owns a trademark in. So the
    // bare words must sit next to a brand or a branded-goods noun; the phrases
    // that only ever mean counterfeit stand on their own.
    re: new RegExp([
      String.raw`\b(?:r[eé]plicas?|replicas?|r[eé]pliques?|clones?|c[oó]pias?|copies|fakes?|imita[çc][oõ]?[ae]?s?|falsificad\w+)\b[^.;!?]{0,40}\b(?:BRANDS)\b`,
      String.raw`\b(?:BRANDS)\b[^.;!?]{0,40}\b(?:r[eé]plicas?|replicas?|r[eé]pliques?|clones?|c[oó]pias?|fakes?|imita[çc][aã]o|falsificad\w+)\b`,
      String.raw`\b(?:counterfeit|contrafa[çc][aã]o|superfake|super\s*fake|1\s*:\s*1\s+(?:copy|c[oó]pia|quality)|c[oó]pia\s+(?:ideal|perfeita|fiel)|inspirad[oa]\s+(?:em|na?)\s+marca|(?:tipo|estilo|style|type)\s+(?:rolex|chanel|cartier|louis\s*vuitton|herm[eè]s|gucci|prada)|(?:aaa+|triple\s*a)\s*(?:quality|grade|qualidade|calidad|qualit[eé])|(?:quality|grade|qualidade)\s*aaa+|fake\s+(?:id|passport|licen[cs]e|currency|money|bill)|forged\s+document|documento\s+falsificado|notas?\s+falsas?|moedas?\s+falsas?)\b`,
    ].join('|').replace(/BRANDS/g, [
      'rolex', 'omega', 'cartier', 'patek(?:\\s*philippe)?', 'audemars',
      'chanel', 'herm[eè]s', 'louis\\s*vuitton', 'gucci', 'prada', 'dior',
      'fendi', 'balenciaga', 'burberry', 'tiffany', 'bu?lgari', 'yves\\s*saint',
      'nike', 'adidas', 'yeezy', 'jordan', 'ray.?ban', 'oakley',
      'rel[oó]gios?', 'watch(?:es)?', 'montres?', 'relojes?',
      'bolsas?', 'malas?', 'handbags?', 'sacs?', 'bolsos?', 'carteiras?', 'wallets?',
      't[eé]nis', 'sneakers?', 'zapatillas', '[oó]culos', 'sunglasses', 'lunettes',
      'perfumes?', 'parfums?', 'joias?', 'jewell?ery', 'an[eé]is', 'pulseiras?',
    ].join('|')), 'i'),
    unless: /\b(?:escala|scale|[eé]chelle|maquete|die[\s-]?cast|diecast|modelismo|model\s*kit|airfix|revell|1\s*[:/]\s*(?:12|18|24|32|43|48|72|87)|museum\s+reproduction|reprodu[çc][aã]o\s+de\s+museu)\b/i,
  },
  {
    category: 'Firearms',
    re: /\b(?:firearm|handgun|pistol|pistolet|revolver|rifle|fusil|shotgun|escopeta|machine\s*gun|sawed.off|assault\s*weapon|ghost\s*gun|zip\s*gun|full\s*auto|suppressors?|silencers?|bump\s*stock|arma\s+de\s+fogo|armas\s+de\s+fogo|arme\s+[aà]\s+feu|pistola|espingarda|ca[çc]adeira|carabina|metralhadora|arma\s+de\s+alarme|arma\s+de\s+press[aã]o|press[aã]o\s+de\s+ar|airsoft|silenciador(?:es)?|arma\s+desativada)\b/i,
    // "pistola de cola" is a glue gun; Revolver is a Beatles LP.
    unless: /\b(?:pistola\s+de\s+(?:cola|pintura|silicone|[aá]gua|ar|massa)|glue\s+gun|paint\s+(?:gun|sprayer)|caulk(?:ing)?\s+gun|water\s+pistol|(?:vinil|vinyl|lp|album|[aá]lbum|disco|cd|beatles)\b[^.]{0,40}revolver|revolver\b[^.]{0,40}(?:vinil|vinyl|lp|album|[aá]lbum|beatles))\b/i,
  },
  {
    category: 'Ammunition, explosives and pyrotechnics',
    re: /\b(?:ammunition|ammo|bullet|grenade|explosive|detonator|c4|pipe\s*bomb|ied|improvised\s*explosive|firework\w*|firecracker|muni[çc][aã]o|muni[çc][oõ]es|muni[ct]ion\w*|cartuchos?\s+de\s+ca[çc]a|p[oó]lvora|explosivos?|detonador(?:es)?|fogo\s+de\s+artif[ií]cio|fogos\s+de\s+artif[ií]cio|pirotecnia|pirot[eé]cnic\w+|petardos?|morteiro\s+pirot[eé]cnico)\b/i,
    unless: /\bgrenadine|rom[aã]|pomegranate|grenade\s+(?:syrup|sirop)\b/i,
  },
  {
    category: 'Prohibited weapons',
    re: /\b(?:switchblade|gravity\s*knife|brass\s*knuckle|knuckle\s*duster|push\s*dagger|throwing\s*star|shuriken|ballistic\s*knife|navalha\s+de\s+ponta\s+e\s+mola|soqueira|boxer\s+de\s+dedos|faca\s+de\s+borboleta|bast[aã]o\s+extens[ií]vel|arma\s+dissimulada|taser|pistola\s+el[eé]trica|arma\s+el[eé]trica|spray\s+de\s+pimenta|g[aá]s\s+pimenta|pepper\s+spray|espadas?|sabres?|punhais?|punhal|baionetas?|bayonets?|sabers?|swords?|katanas?|floretes?)\b/i,
    // "peixe-espada", the suit of spades, swordfish, and "Espada" as a surname.
    unless: /\b(?:peixe[\s-]?espada|espadarte|swordfish|espada\s+fish|(?:rei|dama|[aá]s|naipe|cartas?|baralho|valete)\b[^.]{0,30}espadas?|espadas?\b[^.]{0,30}(?:copas|ouros|paus|naipe|baralho)|sword\s*fish|sabre\s+de\s+champagne|sabrage)\b/i,
  },
  {
    category: 'Live animals',
    re: /\b(?:(?:live|living)\s+(?:animal|bird|reptile|fish|snake|turtle|tortoise|parrot|puppy|kitten|rabbit|hamster|monkey|primate|insect)s?|(?:animal|animais|p[aá]ssaro\w*|aves?|c[aã]o|c[aã]es|cachorr\w+|gat(?:o|os|inho\w*)|coelho\w*|hamster|r[eé]pteis?|r[eé]ptil|cobras?|papagaio\w*|macaco\w*|peixe\w*|tartaruga\w*)\s+(?:vivo|viva|vivos|vivas)|(?:animal|animales|p[aá]jaro\w*|perro\w*|cachorro\w*|gatito\w*|conejo\w*|reptil|serpiente\w*|loro\w*|pez|peces)\s+(?:vivo|viva|vivos|vivas)|(?:animal|animaux|oiseau\w*|chien\w*|chiot\w*|chaton\w*|lapin\w*|reptile\w*|serpent\w*|perroquet\w*|poisson\w*)\s+(?:vivant|vivante|vivants))\b/i,
  },
  {
    category: 'Ivory and protected species',
    // Context is mandatory: bare "ivory"/"marfim" is a colour.
    re: /\b(?:(?:marfim|ivory|ivoire|marfil)\s+(?:de\s+)?(?:elefante|elephant|maci[çc]o|entalhad\w+|esculpid\w+|trabalhado|carved|carving|sculpt\w+|tusk|antigo|pr[eé].?1947)|(?:tusks?|presas?|defesas?|colmillo\w*)\s+(?:de\s+)?(?:elefante|elephant|marfim|ivory|mamute|mammoth)|elephant\s+(?:tusk|ivory)|netsuke|scrimshaw|(?:chifre|corno|horn|cuerno|corne)s?\s+de\s+(?:rinoceronte|rhino|rinoceronte)|rhino(?:ceros)?\s+horn|(?:carapa[çc]a|casco)\s+de\s+tartaruga|tortoise\s*shell|[eé]caille\s+de\s+tortue|caparaz[oó]n\s+de\s+tortuga|dentes?\s+de\s+(?:cachalote|hipop[oó]tamo|morsa|baleia)|(?:sperm\s*whale|hippo(?:potamus)?|walrus|whale)\s+(?:tooth|teeth|ivory|bone)|barbatanas?\s+de\s+baleia|whale\s*bone|peles?\s+de\s+(?:tigre|leopardo|on[çc]a|jaguar|foca|urso\s+polar|zebra|lince|ocelote)|(?:tiger|leopard|jaguar|seal|polar\s*bear|zebra|ocelot)\s+(?:fur|skin|pelt|hide)|coral\s+(?:vermelho|negro|preto)|(?:red|black)\s+coral)\b/i,
    // "cor de marfim", "ivory silk", "tortoiseshell frames", "bone china".
    unless: /\b(?:cor\s+de\s+marfim|tom\s+marfim|branco\s+marfim|marfim\s+(?:claro|p[aá]lido)|ivory\s+(?:white|wool|silk|cotton|linen|leather|paint|coloured?|colored?|tone|shade|cream)|ivory\s*[\/-]\s*\w+|(?:cor|tom|shade|colour|color)\s*:?\s*ivory|tortoise\s*shell\s+(?:frames?|glasses|sunglasses|pattern|effect|acetate|cat)|(?:[oó]culos|arma[çc][aã]o|padr[aã]o|efeito)\b[^.]{0,30}tartaruga|bone\s+china)\b/i,
  },
  {
    category: 'Taxidermy and hunting trophies',
    re: /\b(?:taxiderm\w+|empalhad\w+|disecad\w+|naturalis[eé]\w*|trof[eé]us?\s+de\s+ca[çc]a|hunting\s+troph\w+|troph[eé]es?\s+de\s+chasse|trofeos?\s+de\s+caza|mounted\s+(?:specimen|butterfl\w+|insect|bird|animal|head|antelope|deer)s?|insetos?\s+montados?|borboletas?\s+montadas?|cabe[çc]a\s+(?:de\s+ca[çc]a|montada)|animal\s+embalsamado|embalsamad\w+)\b/i,
    // A rush-seated chair is "cadeira empalhada".
    unless: /\b(?:cadeira\w*|assento\w*|banco\w*|palhinha|rush[\s-]?seat|cane[\s-]?seat)\b[^.]{0,30}empalhad|empalhad\w+\b[^.]{0,30}\b(?:cadeira|assento|banco|palhinha)/i,
  },
  {
    category: 'Human remains',
    re: /\b(?:human\s+(?:skull|bone|bones|skeleton|organ|kidney|liver|heart|remains|tissue|blood|teeth|tooth|hair|body\s*part)s?|(?:cr[aâ]nio|caveira|osso|ossos|esqueleto|[oó]rg[aã]o|tecido|sangue|dente)s?\s+human\w*|restos\s+(?:humanos|mortais)|cr[aá]neo\s+humano|cr[aâ]ne\s+humain|rel[ií]quia\s+[oó]ssea)\b/i,
  },
  {
    category: 'Controlled substances',
    re: /\b(?:cocaine|coca[ií]na|heroin|hero[ií]na|methamphetamine|metanfetamina|\bmeth\b|anfetaminas?|fentanyl|fentanil|lsd|ecstasy|mdma|crack\s+(?:cocaine|rock)|opioid|opi[aá]ceo\w*|haxixe|hachisch|cannabis|canabis|maconha|marijuana|cogumelos\s+m[aá]gicos|magic\s+mushrooms?|estupefacientes?|substâncias?\s+psicoativas?|xanax\s+without|adderall\s+without|bong\b|grinder\s+de\s+erva)\b/i,
  },
  {
    category: 'Medicines, nicotine and vaping products',
    re: /\b(?:medicamentos?|prescription\s+(?:drug|medicine|medication)s?|receita\s+m[eé]dica|m[eé]dicament\w*|viagra|cialis|insulina|antibi[oó]tico\w*|cigarros?\s+eletr[oó]nicos?|e[\s-]?cigarettes?|vapes?|vaping|vaper|e[\s-]?liquids?|l[ií]quido\s+para\s+vaper|nicotina|nicotine\s+pods?|snus)\b/i,
  },
  {
    category: 'Identity documents and official insignia',
    re: /\b(?:cart[aã]o\s+de\s+cidad[aã]o|bilhete\s+de\s+identidade|carta\s+de\s+condu[çc][aã]o|driving\s+licen[cs]e|driver'?s\s+licen[cs]e|national\s+id\s+card|permis\s+de\s+conduire|documento\s+nacional\s+de\s+identidad|n[uú]mero\s+de\s+contribuinte|cart[aã]o\s+de\s+sa[uú]de)\b/i,
  },
  {
    category: 'Financial instruments and redeemable value',
    re: /\b(?:bilhetes?\s+de\s+lotaria|raspadinhas?|lottery\s+tickets?|cart[aã]o[\s-]?(?:oferta|presente)|cart[oõ]es[\s-]?(?:oferta|presente)|gift\s*cards?|tarjetas?\s+regalo|cartes?\s+cadeaux?|criptomoedas?|cryptocurrenc\w+|crypto[\s-]?currenc\w+|\bnfts?\b|a[çc][oõ]es\s+da\s+bolsa)\b/i,
  },
  {
    category: 'Hate symbols',
    // Books and documentaries about the period are legitimate; insignia are not.
    re: /\b(?:su[aá]sticas?|swastikas?|hakenkreuz|waffen[\s-]?ss|ss\s+totenkopf|totenkopf|bra[çc]adeira\s+nazi|nazi\s+armband)\b/i,
    unless: /\b(?:budis\w*|hindu\w*|manji|jain\w*|s[aâ]nscrito|sanskrit|livros?|books?|livres?|libros?|hist[oó]ri\w+|documental|documentary|revista|magazine)\b/i,
  },
  {
    category: 'Adult content',
    re: /\b(?:pornograf\w+|pornograph\w+|\bporn\b|conte[uú]do\s+sexual\s+expl[ií]cito|brinquedos?\s+sexuais?|sex\s+toys?|juguetes?\s+sexuales?|dildos?|vibrador(?:es)?|vibrators?)\b/i,
  },
  {
    category: 'Unprovenanced archaeological finds',
    re: /\b(?:(?:encontrad\w+|achad\w+|detetad\w+|escavad\w+|dug|found)\s+(?:com\s+|with\s+)?(?:o\s+|um\s+|a\s+)?(?:detetor|detector)\s+(?:de\s+)?(?:metais|metals?)|(?:detetor|detector)\s+(?:de\s+)?metais\s+(?:find|achado|encontrado)|metal[\s-]?detect(?:or|ing)\s+finds?)\b/i,
  },
];

/**
 * Scans text for policy keywords.
 *
 * Returns every policy area it matched, not just the first: a listing can trip
 * ivory and taxidermy at once, and a reviewer who only sees one of them has to
 * find the other by reading.
 *
 * @param {string} text
 * @returns {{ flagged: boolean, categories: string[] }}
 */
function scanForPolicyFlags(text) {
  if (!text || typeof text !== 'string') return { flagged: false, categories: [] };
  const categories = PROHIBITED_PATTERNS
    .filter(({ re, unless }) => re.test(text) && !(unless && unless.test(text)))
    .map(({ category }) => category);
  return { flagged: categories.length > 0, categories };
}

/**
 * Scans multiple text fields (title + description, in every language) and
 * returns the union of what they matched.
 * @param {string[]} texts
 * @returns {{ flagged: boolean, categories: string[] }}
 */
function scanTextsForPolicyFlags(texts) {
  const categories = new Set();
  for (const text of texts) {
    scanForPolicyFlags(text).categories.forEach((c) => categories.add(c));
  }
  return { flagged: categories.size > 0, categories: [...categories] };
}

module.exports = {
  scanForContactInfo,
  scanTexts,
  describeContactInfoTypes,
  scanForAbusiveContent,
  normalizeText,
  getAbuseSeverity,
  PROHIBITED_PATTERNS,
  scanForPolicyFlags,
  scanTextsForPolicyFlags
};
