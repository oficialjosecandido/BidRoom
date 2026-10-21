const fs = require('fs');
const path = require('path');
const { scanForPolicyFlags, PROHIBITED_PATTERNS } = require('../src/utils/contentFilter');

/**
 * The policy filter does not refuse a listing — it flags one for the reviewer in
 * Nexus. So the cost of a false positive is a reviewer's attention, not a lost
 * sale. That still has to be defended: a filter that flags the whole catalogue
 * teaches reviewers to click past it, at which point it protects nothing.
 *
 * Hence the two halves. The first proves the policy is actually detected in the
 * four languages the marketplace sells in. The second proves it stays quiet on
 * legitimate listings, and draws most of its cases from the repository itself —
 * every subcategory in the live catalogue and every string in the seed data —
 * so that adding a category or a pattern that collide fails here rather than in
 * front of a seller.
 */

const SHOULD_FLAG = {
  'Counterfeit or replica goods': [
    'Réplica Rolex Submariner AAA quality',
    'Replica Chanel bag 1:1 copy',
    'Bolsa inspirada na marca Louis Vuitton',
    'Relógio tipo Rolex em aço',
    'Clone watch Daytona',
    'Fake Rolex gold',
    'Notas falsas de 50 euros',
    'Cópia de bolsa Hermès em pele',
  ],
  Firearms: [
    'Espingarda de caça antiga calibre 12',
    'Pistola Walther PPK desativada',
    'Arma de fogo antiga do século XIX',
    'Carabina de pressão de ar',
    'Caçadeira de dois canos',
    'Pistolet de collection',
    'Escopeta antigua',
  ],
  'Ammunition, explosives and pyrotechnics': [
    'Munições calibre 9mm',
    'Cartuchos de caça novos',
    'Pólvora negra',
    'Fogo de artifício profissional',
    'Petardos de festa',
    'Fireworks box',
  ],
  'Prohibited weapons': [
    'Navalha de ponta e mola italiana',
    'Soqueira de latão',
    'Espada samurai katana',
    'Sabre de cavalaria 1890',
    'Punhal otomano',
    'Baioneta Mauser alemã',
    'Spray de pimenta defesa pessoal',
    'Taser X26',
  ],
  'Live animals': [
    'Papagaio vivo falante',
    'Cão vivo para adoção',
    'Live turtle for sale',
    'Perro vivo pequeño',
    'Chiot vivant à vendre',
    'Peixes vivos ornamentais',
  ],
  'Ivory and protected species': [
    'Marfim de elefante entalhado antigo',
    'Netsuke japonês assinado',
    'Presas de elefante par',
    'Elephant tusk carving',
    'Scrimshaw gravado',
    'Chifre de rinoceronte',
    'Rhino horn cup',
    'Carapaça de tartaruga escova',
    'Dentes de cachalote gravados',
    'Pele de tigre completa',
    'Leopard fur coat',
    'Coral vermelho colar',
  ],
  'Taxidermy and hunting trophies': [
    'Taxidermia de raposa',
    'Raposa empalhada',
    'Troféu de caça de veado',
    'Hunting trophy kudu',
    'Insetos montados em quadro',
    'Borboletas montadas',
    'Animal embalsamado vitrine',
    'Zorro disecado',
  ],
  'Human remains': [
    'Crânio humano antigo',
    'Human skull real',
    'Ossos humanos de coleção',
    'Restos mortais em relicário',
    'Crâne humain ancien',
  ],
  'Controlled substances': [
    'Cocaína',
    'Haxixe marroquino',
    'Cogumelos mágicos secos',
    'MDMA cristal',
    'Crack cocaine',
    'Bong de vidro',
  ],
  'Medicines, nicotine and vaping products': [
    'Medicamentos para dormir',
    'Cigarro eletrónico Juul',
    'E-liquid nicotina',
    'Vape pod kit',
    'Viagra 100mg',
    'Snus sueco',
  ],
  'Identity documents and official insignia': [
    'Cartão de cidadão',
    'Carta de condução portuguesa',
    'Driving licence UK',
  ],
  'Financial instruments and redeemable value': [
    'Bilhete de lotaria premiado',
    'Cartão-oferta 100 euros',
    'Gift card Amazon',
    'Criptomoeda carteira',
    'NFT exclusivo',
    'Raspadinha nova',
  ],
  'Hate symbols': [
    'Braçadeira nazi com suástica',
    'Waffen-SS insígnia',
    'Totenkopf anel',
  ],
  'Adult content': [
    'Pornografia vintage',
    'Sex toy novo',
    'Vibrador recarregável',
  ],
  'Unprovenanced archaeological finds': [
    'Moeda romana encontrada com detetor de metais',
    'Fíbula achada com detetor de metais',
    'Metal detecting find silver',
  ],
};

/**
 * Legitimate listings that must stay quiet. Each one is a word the policy cares
 * about used in the sense it usually carries on a marketplace: "ivory" the
 * colour, "pele" the leather, "Revolver" the record, "espadas" the suit, "AAA"
 * the battery, "empalhada" the rush-seated chair.
 */
const SHOULD_PASS = [
  // Colours and materials that merely sound like protected species.
  'Beni Ourain rug in natural ivory wool',
  'Mongolian lamb faux-fur throw in ivory',
  'Vestido de seda cor de marfim',
  'Ivory silk wedding dress',
  'Branco marfim, tamanho 38',
  'Óculos com armação padrão tartaruga',
  'Tortoiseshell frames acetate glasses',
  'Bone china tea set Royal Albert',
  'Mala de pele de vitela italiana',
  'Casaco em pele de carneiro',
  'Chifre de boi, trompa de caça decorativa',
  'French horn Yamaha',
  // Records, gemstones, tools and toys that collide with weapons vocabulary.
  'The Beatles Revolver LP vinil 1966',
  'Revolver vinyl first pressing',
  'Pistola de cola quente profissional',
  'Glue gun with 20 sticks',
  'Paint sprayer gun compressor',
  'Water pistol toy 1970s',
  'Granada pedra preciosa 2 quilates',
  'Xarope de grenadine francês',
  'Peixe-espada em prata, escultura',
  'Rei de espadas, baralho antigo',
  'Baralho completo copas ouros paus espadas',
  'Sabre de champagne Laguiole',
  'Swordfish trophy replica in resin',
  // Honest reproductions, which the policy allows; only brand copies do not.
  'Réplica em escala 1:18 Ferrari F40',
  'Die-cast replica 1:43 Porsche',
  'Maquete réplica de navio',
  'Model kit Revell 1:72 Spitfire',
  'Pilhas AAA alcalinas',
  'AAA batteries pack of 12',
  // Furniture, ceramics and figurines.
  'Cadeira empalhada em palhinha restaurada',
  'Rush-seat chair empalhada antiga',
  'Jarra com craquelé, pequeno crack no vidrado',
  'Hairline crack on the base',
  'Cão de porcelana Staffordshire par',
  'Gato de bronze egípcio',
  'Tartaruga em jade esculpida',
  // Historical material about a period is not an artefact of it.
  'Livro sobre a suástica e o Terceiro Reich',
  'Book about Nazi propaganda posters',
  'Uniforme militar da Primeira Guerra',
  'Medalha de mérito militar 1918',
  // Tobacco-related collectibles, which are objects rather than tobacco.
  'Tabaqueira em prata com cigarreira',
  'Caixa de charutos humidor em cedro',
  'Cartaz publicitário de tabaco anos 50',
  'Isqueiro Dupont em ouro',
  'Frasco de farmácia antigo em vidro azul',
  // Paper collectibles that share vocabulary with documents and tickets.
  'Documento histórico manuscrito de 1820',
  'Bilhete postal ilustrado de Lisboa',
  'Programa e bilhete de jogo de 1966',
  'Ações da Companhia 1910, scripophily',
  'Moeda comemorativa de prata 1000 escudos',
  // Restricted-but-allowed goods: a reviewer checks the papers, not a regex.
  'Antiguidade romana, lamparina em terracota, com proveniência',
  'Fóssil de amonite polido',
  'Meteorito Campo del Cielo 240g',
  'Âmbar báltico com inseto incluso',
  'Garrafa de Vinho do Porto Vintage 1963',
  'Whisky Macallan 18 anos',
  'Perfume Chanel nº5 selado',
  // Ordinary listings in the newer categories.
  'Vestido vintage Dior anos 60',
  'Camisola usada em jogo pelo Eusébio',
  'Guitarra Fender Stratocaster 1972',
  'Disco de vinil dos Pink Floyd',
  'Álbum de banda desenhada Tintin primeira edição',
  'Selos clássicos de Portugal antes de 1900',
];

describe('policy filter — flags what the policy covers', () => {
  for (const [category, samples] of Object.entries(SHOULD_FLAG)) {
    describe(category, () => {
      for (const text of samples) {
        it(`flags ${JSON.stringify(text)}`, () => {
          const result = scanForPolicyFlags(text);
          expect(result.flagged).toBe(true);
          expect(result.categories).toContain(category);
        });
      }
    });
  }

  it('covers every pattern with at least one sample', () => {
    const covered = Object.keys(SHOULD_FLAG);
    const declared = PROHIBITED_PATTERNS.map(p => p.category);
    expect(declared.filter(c => !covered.includes(c))).toEqual([]);
  });
});

describe('policy filter — stays quiet on legitimate listings', () => {
  for (const text of SHOULD_PASS) {
    it(`passes ${JSON.stringify(text)}`, () => {
      expect(scanForPolicyFlags(text)).toEqual({ flagged: false, categories: [] });
    });
  }
});

describe('policy filter — against the repository itself', () => {
  it('flags no subcategory in the live catalogue', () => {
    const config = fs.readFileSync(
      path.join(__dirname, '../../frontend/src/app/shared/config/categories.config.ts'),
      'utf8'
    );
    const subCategories = new Set();
    for (const block of config.match(/subCategories:\s*\[[\s\S]*?\]/g) || []) {
      for (const m of block.matchAll(/'((?:[^'\\]|\\.)*)'/g)) {
        subCategories.add(m[1].replace(/\\'/g, "'"));
      }
    }
    expect(subCategories.size).toBeGreaterThan(200);

    const flagged = [...subCategories]
      .map(s => [s, scanForPolicyFlags(s)])
      .filter(([, r]) => r.flagged)
      .map(([s, r]) => `${s} → ${r.categories.join(', ')}`);
    expect(flagged).toEqual([]);
  });

  it('flags nothing in the seed listings', () => {
    const seed = fs.readFileSync(path.join(__dirname, '../src/scripts/seed100Listings.js'), 'utf8');
    const strings = [...seed.matchAll(/(?:title|description):\s*(['"`])((?:[^\\]|\\.)*?)\1/g)].map(m => m[2]);
    expect(strings.length).toBeGreaterThan(50);

    const flagged = strings
      .map(s => [s, scanForPolicyFlags(s)])
      .filter(([, r]) => r.flagged)
      .map(([s, r]) => `${s.slice(0, 60)} → ${r.categories.join(', ')}`);
    expect(flagged).toEqual([]);
  });
});
