'use strict';

/**
 * Structured attribute schemas, keyed by a canonical slug.
 *
 * Each attribute entry:
 *   key          – machine key stored in listing.attributes
 *   labelKey     – i18n key under addListing.attributes.fields.* (frontend)
 *   label        – Portuguese fallback (API / older clients)
 *   type         – 'text' | 'number' | 'boolean' | 'enum'
 *   required     – validated on listing creation
 *   filterable   – exposed as a search/filter facet
 *   schemaOrg    – optional Schema.org property name for SEO
 *   options      – required when type === 'enum'
 *   unit         – optional display unit (mm, g …)
 */

const SCHEMAS = {
  // ─── Relógios ────────────────────────────────────────────────────────────────
  watches: [
    { key: 'brand',       labelKey: 'brand',       label: 'Marca',         type: 'text', required: false, filterable: true, schemaOrg: 'brand' },
    { key: 'referenceNo', labelKey: 'referenceNo', label: 'Referência',    type: 'text', required: false, filterable: true },
    { key: 'year',        labelKey: 'yearPeriod',  label: 'Ano / período', type: 'text', required: false, filterable: true },
  ],

  // ─── Arte ────────────────────────────────────────────────────────────────────
  art: [
    { key: 'artist',       labelKey: 'artist',       label: 'Artista / autor',              type: 'text',    required: true,  filterable: true, schemaOrg: 'creator' },
    { key: 'technique',    labelKey: 'technique',    label: 'Técnica',                      type: 'text',    required: true,  filterable: true },
    { key: 'year',         labelKey: 'yearPeriod',   label: 'Ano / período',                type: 'text',    required: false, filterable: true },
    { key: 'dimensions',   labelKey: 'dimensionsCm', label: 'Dimensões (cm)',               type: 'text',    required: true },
    { key: 'signed',       labelKey: 'signed',       label: 'Assinado',                     type: 'boolean', required: true,  filterable: true },
    { key: 'framed',       labelKey: 'framed',       label: 'Emoldurado',                   type: 'boolean', required: false },
    { key: 'provenance',   labelKey: 'provenance',   label: 'Proveniência documentada',     type: 'boolean', required: true,  filterable: true },
    { key: 'certificate',  labelKey: 'certificateAuth', label: 'Certificado de autenticidade', type: 'boolean', required: true,  filterable: true },
  ],

  // ─── Joalharia (sem relógios) ─────────────────────────────────────────────
  jewelry: [
    { key: 'material',     labelKey: 'material',     label: 'Material',                  type: 'text',    required: true,  filterable: true },
    { key: 'gemstone',     labelKey: 'gemstone',     label: 'Pedra principal',           type: 'text',    required: false, filterable: true },
    { key: 'carat',        labelKey: 'carat',        label: 'Quilates',                  type: 'number',  required: false, filterable: true },
    { key: 'hallmark',     labelKey: 'hallmark',     label: 'Marca de contraste',        type: 'boolean', required: false, filterable: true },
    { key: 'certificate',  labelKey: 'certificateGem', label: 'Certificado gemológico',  type: 'boolean', required: true,  filterable: true },
    { key: 'period',       labelKey: 'period',       label: 'Período',                   type: 'text',    required: false, filterable: true },
  ],

  // ─── Selos / Filatelia ───────────────────────────────────────────────────
  stamps: [
    { key: 'country',      labelKey: 'countryOrigin', label: 'País de origem',            type: 'text',    required: true,  filterable: true },
    { key: 'year',         labelKey: 'yearIssue',     label: 'Ano de emissão',            type: 'text',    required: true,  filterable: true },
    { key: 'denomination', labelKey: 'faceValue',     label: 'Valor facial',              type: 'text',    required: false, filterable: true },
    { key: 'condition',    labelKey: 'philatelicCondition', label: 'Estado filatelico',   type: 'enum',    required: true,  filterable: true,
      options: ['Novo sem charneira (MNH)', 'Novo com charneira (MH)', 'Usado (FU)', 'Novo no bloco'] },
    { key: 'gummed',       labelKey: 'gummed',        label: 'Com goma',                  type: 'boolean', required: false, filterable: true },
    { key: 'certified',    labelKey: 'certifiedExpert', label: 'Certificado por perito',  type: 'boolean', required: false, filterable: true },
  ],

  // ─── Moedas & Notas ──────────────────────────────────────────────────────
  coins: [
    { key: 'country',      labelKey: 'country',       label: 'País',                      type: 'text',    required: true,  filterable: true },
    { key: 'year',         labelKey: 'yearMinted',    label: 'Ano de cunhagem',           type: 'text',    required: true,  filterable: true },
    { key: 'denomination', labelKey: 'denomination',  label: 'Denominação',               type: 'text',    required: false, filterable: true },
    { key: 'metal',        labelKey: 'metal',         label: 'Metal',                     type: 'text',    required: false, filterable: true },
    { key: 'grade',        labelKey: 'grade',         label: 'Grau / estado',             type: 'text',    required: false, filterable: true },
    { key: 'certified',    labelKey: 'certifiedPcgs', label: 'Certificado (PCGS/NGC/…)',  type: 'boolean', required: false, filterable: true },
  ],

  // ─── Veículos (alinhado com campos típicos OLX / Standvirtual) ────────────
  // Entrega é sempre encontro presencial — sem envio postal.
  vehicles: [
    { key: 'make',         labelKey: 'brand',         label: 'Marca',                        type: 'text',    required: false, filterable: true, schemaOrg: 'brand' },
    { key: 'model',        labelKey: 'model',         label: 'Modelo',                       type: 'text',    required: false, filterable: true },
    { key: 'year',         labelKey: 'year',          label: 'Ano',                          type: 'number',  required: false, filterable: true },
    { key: 'mileage',      labelKey: 'mileage',       label: 'Quilómetros',                  type: 'number',  required: false, filterable: true, unit: 'km' },
    { key: 'fuel',         labelKey: 'fuel',          label: 'Combustível',                  type: 'enum',    required: false, filterable: true,
      options: ['Gasolina', 'Diesel', 'Elétrico', 'Híbrido Plug-in', 'Híbrido Mild', 'GPL', 'Outro'] },
    { key: 'transmission', labelKey: 'transmission',  label: 'Tipo de caixa',                type: 'enum',    required: false, filterable: true,
      options: ['Manual', 'Automático', 'Semi-automático'] },
    { key: 'engineSize',   labelKey: 'engineSize',    label: 'Cilindrada (cm³)',             type: 'number',  required: false, filterable: true, unit: 'cm³' },
    { key: 'power',        labelKey: 'power',         label: 'Potência (cv)',                type: 'number',  required: false, filterable: true, unit: 'cv' },
    { key: 'bodyType',     labelKey: 'bodyType',      label: 'Tipo de carroçaria',           type: 'enum',    required: false, filterable: true,
      options: ['Citadino', 'Sedan', 'Carrinha', 'SUV / Todo-o-terreno', 'Coupé', 'Cabrio', 'Monovolume', 'Comercial', 'Outro'] },
    { key: 'color',        labelKey: 'color',         label: 'Cor',                          type: 'text',    required: false, filterable: true },
    { key: 'doors',        labelKey: 'doors',         label: 'Número de portas',             type: 'enum',    required: false, filterable: true,
      options: ['2', '3', '4', '5'] },
    { key: 'seats',        labelKey: 'seats',         label: 'Número de lugares',            type: 'enum',    required: false, filterable: true,
      options: ['2', '4', '5', '6', '7', '8+'] },
    { key: 'inspection',   labelKey: 'inspection',    label: 'IPO / inspeção válida',        type: 'boolean', required: false, filterable: true },
    { key: 'iuc',          labelKey: 'iuc',           label: 'IUC em dia',                   type: 'boolean', required: false, filterable: false },
    { key: 'owners',       labelKey: 'owners',        label: 'Nº de proprietários anteriores', type: 'number', required: false, filterable: false },
    { key: 'plate',        labelKey: 'plate',         label: 'Matrícula',                    type: 'text',    required: false, filterable: false },
    { key: 'vin',          labelKey: 'vin',           label: 'Número de chassis (VIN)',      type: 'text',    required: false, filterable: false },
  ],

  // ─── Genérico ────────────────────────────────────────────────────────────
  default: [
    { key: 'brand',    labelKey: 'brand',    label: 'Marca',    type: 'text', required: false, filterable: true, schemaOrg: 'brand' },
    { key: 'year',     labelKey: 'year',     label: 'Ano',      type: 'text', required: false, filterable: true },
    { key: 'material', labelKey: 'material', label: 'Material', type: 'text', required: false },
  ],
};

// Maps subCategory strings (as stored in listings) → schema slug.
// Falls back to category slug, then to 'default'.
const SUBCATEGORY_MAP = {
  // Watches
  'Luxury Watches':   'watches',
  'Vintage Watches':  'watches',
  'Smart Watches':    'watches',
  // Art
  'Paintings':        'art',
  'Drawings':         'art',
  'Prints':           'art',
  'Photography':      'art',
  'Sculptures':       'art',
  'Figurines':        'art',
  // Jewelry (non-watch)
  'Engagement Rings':    'jewelry',
  'Wedding Rings':       'jewelry',
  'Fashion Rings':       'jewelry',
  'Chains':              'jewelry',
  'Pendants':            'jewelry',
  'Bangles':             'jewelry',
  'Charm Bracelets':     'jewelry',
  'Stud Earrings':       'jewelry',
  'Hoop Earrings':       'jewelry',
  'Drop Earrings':       'jewelry',
  'Brooches & Pins':     'jewelry',
  'Jewelry Sets':        'jewelry',
  'Loose Gemstones':     'jewelry',
  // Stamps / philately
  'Definitive Stamps':       'stamps',
  'Commemorative Stamps':    'stamps',
  'Airmail Stamps':          'stamps',
  'Postage Due Stamps':      'stamps',
  'Revenue / Fiscal Stamps': 'stamps',
  'Official Stamps':         'stamps',
  'Military Mail':           'stamps',
  'Local Issues':            'stamps',
  'First Day Covers (FDC)':  'stamps',
  'Stamp Booklets':          'stamps',
  'Collections / Lots':      'stamps',
  'Classic Stamps (Before 1900)':     'stamps',
  'Early 20th Century (1900 to 1945)': 'stamps',
  'Post War (1945 to 1960)':          'stamps',
  'Late 20th Century (1960 to 2000)': 'stamps',
  'Modern Stamps (2000 to Present)':  'stamps',
  // Coins
  'Coins & Banknotes': 'coins',
  // Vehicles
  'Cars':                   'vehicles',
  'Classic Cars':           'vehicles',
  'Electric & Hybrid Cars': 'vehicles',
  'Motorcycles':            'vehicles',
  'Scooters & Mopeds':      'vehicles',
  'Vans & Minibuses':       'vehicles',
  'Trucks & HGV':           'vehicles',
  'Boats':                  'vehicles',
  'Jet Skis & Watercraft':  'vehicles',
  'Sailboats':              'vehicles',
  'Caravans & Motorhomes':  'vehicles',
  'ATVs & Quad Bikes':      'vehicles',
};

// Category-level fallbacks (used when no subCategory match above)
const CATEGORY_MAP = {
  art:      'art',
  jewelry:  'jewelry',
  vehicles: 'vehicles',
  collectibles: 'stamps', // sensible default; stamp-heavy vertical
};

/**
 * Returns the structured attribute schema for a given subCategory / category.
 * Never throws — always returns at least the default schema.
 */
function getAttributeSchema(subCategory, category) {
  const slug = SUBCATEGORY_MAP[subCategory]
    ?? CATEGORY_MAP[category]
    ?? null;
  return slug ? SCHEMAS[slug] : SCHEMAS.default;
}

/**
 * Returns the schema slug (for debugging / SEO mapping).
 */
function getSchemaSlug(subCategory, category) {
  return SUBCATEGORY_MAP[subCategory] ?? CATEGORY_MAP[category] ?? 'default';
}

module.exports = { SCHEMAS, getAttributeSchema, getSchemaSlug };
