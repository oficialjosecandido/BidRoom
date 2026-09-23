import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { DOCUMENT } from '@angular/common';
import { Listing } from './listings.service';
import { BlogPost } from './blog.service';
import { listingImageSrc, listingImageSrcSet, LISTING_HERO_SIZES } from '../utils/listing-image';

const BASE_URL   = 'https://www.bidroom.pt';
const DEFAULT_OG = `${BASE_URL}/og-image.png`;
const LCP_PRELOAD_ID = 'listing-lcp-preload';

const DEFAULTS = {
  title:       'BidRoom — Leilões Premium',
  description: 'Compra e vende artigos únicos através de leilões em tempo real, Melhor Proposta ou Sala Privada. Pagamentos seguros, payouts directos.',
  url:         BASE_URL,
  image:       DEFAULT_OG,
};

/** Format EUR without cents when the value is a round number, for shorter descriptions. */
function fmtEur(value: number): string {
  return new Intl.NumberFormat('pt-PT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

@Injectable({ providedIn: 'root' })
export class SeoService {
  private meta  = inject(Meta);
  private title = inject(Title);
  private doc   = inject(DOCUMENT);

  setDefault(): void {
    this.apply(DEFAULTS);
    this.removeListingLcpPreload();
    this.injectOrganizationSchema();
  }

  /**
   * Sets title, meta, OG/Twitter and JSON-LD structured data for a listing page.
   *
   * Title format (≤60 chars):  "[Product] | [Category] | Leilão · BidRoom"
   * Description (≤155 chars):  "[snippet] — Leilão a partir de €X. Lance já."
   */
  setListing(listing: Listing, backendShareUrl?: string): void {
    const canonical = `${BASE_URL}/listing/${listing.slug}`;

    const rawTitle   = listing.titlePt || listing.titleEn || listing.title || '';
    const rawDescPt  = listing.descriptionPt || listing.descriptionEn || listing.description || '';
    const cleanDesc  = rawDescPt.replace(/\s+/g, ' ').trim();
    const image      = listing.images?.[0] || DEFAULT_OG;

    this.apply({
      title:       this.buildListingTitle(rawTitle, listing.category),
      description: this.buildListingDescription(listing, cleanDesc),
      url:         backendShareUrl || canonical,
      image,
    });

    this.setCanonical(canonical);
    this.setListingOgType('product');
    this.injectListingSchema(listing, image, canonical);
    this.setListingLcpPreload(image);
  }

  /** Sets title/meta for the blog index page. */
  setBlogIndex(): void {
    const canonical = `${BASE_URL}/blog`;
    this.apply({
      title:       'Blog | BidRoom',
      description: 'Tendências, guias e dados do mercado de leilões — relógios, arte e colecionismo em Portugal.',
      url:         canonical,
      image:       DEFAULT_OG,
    });
    this.setCanonical(canonical);
    this.removeListingLcpPreload();
    this.injectOrganizationSchema();
  }

  /** Sets title, meta, OG/Twitter and JSON-LD Article structured data for a blog post page. */
  setBlogPost(post: BlogPost, lang: string = 'pt'): void {
    const canonical = `${BASE_URL}/blog/${post.slug}`;
    const image = post.coverImage || DEFAULT_OG;
    const title = lang === 'en' && post.titleEn ? post.titleEn : post.title;
    const metaDesc = lang === 'en' && post.metaDescriptionEn ? post.metaDescriptionEn : post.metaDescription;
    const excerpt = lang === 'en' && post.excerptEn ? post.excerptEn : post.excerpt;
    const description = metaDesc || excerpt || '';

    this.apply({
      title:       `${title} | Blog · BidRoom`.slice(0, 70),
      description: description.length > 155 ? `${description.slice(0, 152)}…` : description,
      url:         canonical,
      image,
    });

    this.setCanonical(canonical);
    this.setListingOgType('article');
    this.removeListingLcpPreload();
    this.injectBlogPostSchema(post, image, canonical, lang);
  }

  /**
   * Self-referencing canonical for a plain content route.
   *
   * Every page needs one that points at itself — a canonical pointing at the
   * domain root from a non-root URL tells Google the page is a duplicate of
   * the homepage, which is what Lighthouse flags. Query strings and the
   * trailing slash are dropped so /a, /a/ and /a?x=1 collapse to one URL.
   */
  setCanonicalForRoute(path: string): void {
    const clean = path.split(/[?#]/)[0].replace(/\/+$/, '');
    this.setCanonical(clean ? `${BASE_URL}${clean}` : `${BASE_URL}/`);
    this.removeListingLcpPreload();
  }

  resetToDefault(): void {
    this.setDefault();
    this.removeCanonical();
    this.removeListingLcpPreload();
    this.removeJsonLd('listing-schema');
    this.removeJsonLd('blogpost-schema');
  }

  // ── Private — title / description helpers ──────────────────────────────────

  private buildListingTitle(rawTitle: string, category?: string): string {
    const brand  = ' · BidRoom';
    const suffix = ` | Leilão${brand}`;

    const withCat = category
      ? `${rawTitle} | ${category}${suffix}`
      : `${rawTitle}${suffix}`;

    if (withCat.length <= 60) return withCat;

    const withoutCat = `${rawTitle}${suffix}`;
    if (withoutCat.length <= 60) return withoutCat;

    const maxTitle = 60 - suffix.length - 1;
    return `${rawTitle.slice(0, maxTitle)}…${suffix}`;
  }

  private buildListingDescription(listing: Listing, cleanDesc: string): string {
    const price = this.resolveListingPrice(listing);
    const priceStr  = price != null ? fmtEur(price) : 'proposta';
    const format    = listing.auctionFormat === 'best-offer' ? 'Melhor Proposta' : 'Leilão';
    const cta       = listing.saleFormat === 'giveaway'
      ? 'Passatempo gratuito, sem obrigação de compra. Participe já.'
      : price != null
        ? `${format} a partir de ${priceStr}. Lance já.`
        : `${format} aberta. Faça a sua proposta.`;

    if (!cleanDesc) return cta;

    const budget = 155 - 3 - cta.length; // 3 for " — "
    const snippet = cleanDesc.length > budget
      ? `${cleanDesc.slice(0, budget - 1)}…`
      : cleanDesc;

    return `${snippet} — ${cta}`;
  }

  /** Best display/schema price: current → starting → buy-now → minimum offer. */
  private resolveListingPrice(listing: Listing): number | null {
    const candidates = [
      listing.currentPrice,
      listing.startingPrice,
      listing.buyNowPrice,
      listing.minimumOfferPrice,
    ];
    for (const value of candidates) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value;
      }
    }
    return null;
  }

  // ── Private — meta helpers ─────────────────────────────────────────────────

  private apply(p: { title: string; description: string; url: string; image: string }): void {
    this.title.setTitle(p.title);

    this.meta.updateTag({ name: 'description', content: p.description });

    this.meta.updateTag({ property: 'og:title',       content: p.title });
    this.meta.updateTag({ property: 'og:description', content: p.description });
    this.meta.updateTag({ property: 'og:url',         content: p.url });
    this.meta.updateTag({ property: 'og:image',       content: p.image });
    this.meta.updateTag({ property: 'og:type',        content: 'website' });
    this.applyImageMeta(p.image);

    this.meta.updateTag({ name: 'twitter:title',       content: p.title });
    this.meta.updateTag({ name: 'twitter:description', content: p.description });
    this.meta.updateTag({ name: 'twitter:image',       content: p.image });
    this.meta.updateTag({ name: 'twitter:card',        content: 'summary_large_image' });
  }

  /**
   * Keeps og:image:width/height/type consistent with the image actually set.
   *
   * index.html ships the tags for the branded 1200×630 PNG fallback. Left
   * alone, a listing photo inherits those values — crawlers then lay out the
   * preview for dimensions and a format the file does not have. We only know
   * the size of our own default, so for anything else the dimensions are
   * dropped rather than guessed.
   */
  private applyImageMeta(image: string): void {
    if (image === DEFAULT_OG) {
      this.meta.updateTag({ property: 'og:image:width',  content: '1200' });
      this.meta.updateTag({ property: 'og:image:height', content: '630' });
      this.meta.updateTag({ property: 'og:image:type',   content: 'image/png' });
      return;
    }

    this.meta.removeTag('property="og:image:width"');
    this.meta.removeTag('property="og:image:height"');

    const type = SeoService.imageMimeType(image);
    if (type) {
      this.meta.updateTag({ property: 'og:image:type', content: type });
    } else {
      this.meta.removeTag('property="og:image:type"');
    }
  }

  /** Mime type from the URL extension; null when it is not one we recognise. */
  private static imageMimeType(url: string): string | null {
    // Uploads carry a double extension (…​.webp.webp), so match the last one.
    const clean = url.split(/[?#]/)[0].toLowerCase();
    if (/\.jpe?g$/.test(clean)) return 'image/jpeg';
    if (/\.png$/.test(clean))   return 'image/png';
    if (/\.gif$/.test(clean))   return 'image/gif';
    if (/\.webp$/.test(clean))  return 'image/webp';
    if (/\.avif$/.test(clean))  return 'image/avif';
    return null;
  }

  private setListingOgType(type: string): void {
    this.meta.updateTag({ property: 'og:type', content: type });
  }

  private setCanonical(url: string): void {
    let link: HTMLLinkElement | null = this.doc.querySelector('link[rel="canonical"]');
    if (!link) {
      link = this.doc.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.doc.head.appendChild(link);
    }
    link.setAttribute('href', url);
  }

  private removeCanonical(): void {
    this.doc.querySelector('link[rel="canonical"]')?.remove();
  }

  /**
   * Kick off the listing hero download in &lt;head&gt; during SSR / early hydration,
   * so mobile LCP does not wait for Angular to paint the &lt;img&gt;.
   */
  private setListingLcpPreload(originalImage: string): void {
    if (!originalImage || originalImage === DEFAULT_OG) {
      this.removeListingLcpPreload();
      return;
    }

    const href = listingImageSrc(originalImage, 'thumb');
    const srcset = listingImageSrcSet(originalImage);

    let link = this.doc.getElementById(LCP_PRELOAD_ID) as HTMLLinkElement | null;
    if (!link) {
      link = this.doc.createElement('link');
      link.id = LCP_PRELOAD_ID;
      link.setAttribute('rel', 'preload');
      link.setAttribute('as', 'image');
      link.setAttribute('fetchpriority', 'high');
      this.doc.head.appendChild(link);
    }

    link.setAttribute('href', href);
    if (srcset) {
      link.setAttribute('imagesrcset', srcset);
      link.setAttribute('imagesizes', LISTING_HERO_SIZES);
    } else {
      link.removeAttribute('imagesrcset');
      link.removeAttribute('imagesizes');
    }
  }

  private removeListingLcpPreload(): void {
    this.doc.getElementById(LCP_PRELOAD_ID)?.remove();
  }

  // ── Private — Schema.org JSON-LD ──────────────────────────────────────────

  private injectOrganizationSchema(): void {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          name:    'BidRoom',
          url:     BASE_URL,
          logo:    `${BASE_URL}/favicon.svg`,
          sameAs:  [
            'https://www.instagram.com/bidroompt',
            'https://twitter.com/bidroompt',
          ],
        },
        {
          '@type': 'WebSite',
          name:    'BidRoom',
          url:     BASE_URL,
          potentialAction: {
            '@type':        'SearchAction',
            target: {
              '@type':      'EntryPoint',
              urlTemplate:  `${BASE_URL}/listings?q={search_term_string}`,
            },
            'query-input':  'required name=search_term_string',
          },
        },
      ],
    };
    this.injectJsonLd('org-schema', schema);
  }

  private injectListingSchema(listing: Listing, image: string, canonical: string): void {
    const price = this.resolveListingPrice(listing);
    const sellerName = listing.seller
      ? `${listing.seller.firstName} ${listing.seller.lastName}`.trim()
      : undefined;
    const country = listing.locationCountry || 'PT';

    // Google Product snippets require offers, review, or aggregateRating.
    // Never emit Product without a valid Offer — that is the Soft/critical GSC error.
    if (price == null) {
      this.injectJsonLd('listing-schema', {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: listing.titlePt || listing.titleEn || listing.title,
        description: (listing.descriptionPt || listing.descriptionEn || listing.description || '')
          .replace(/\s+/g, ' ').trim().slice(0, 500),
        url: canonical,
        primaryImageOfPage: { '@type': 'ImageObject', url: image },
      });
      return;
    }

    const offer: Record<string, unknown> = {
      '@type': 'Offer',
      priceCurrency: 'EUR',
      price: price.toFixed(2),
      availability: listing.status === 'active'
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      url: canonical,
      ...(sellerName && {
        seller: { '@type': 'Person', name: sellerName },
      }),
    };

    const validFrom = this.toIsoDate(listing.startDate || listing.createdAt);
    if (validFrom) offer['validFrom'] = validFrom;

    const priceValidUntil = this.toIsoDate(listing.endDate);
    if (priceValidUntil) offer['priceValidUntil'] = priceValidUntil;

    const itemCondition = this.mapItemCondition(listing.condition);
    if (itemCondition) offer['itemCondition'] = itemCondition;

    const returnPolicy = this.buildReturnPolicy(listing.returnPolicy, country);
    if (returnPolicy) offer['hasMerchantReturnPolicy'] = returnPolicy;

    // Always declare shipping — GSC Merchant listings flags missing shippingDetails.
    offer['shippingDetails'] = this.buildShippingDetails(listing, country);

    const schema: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: listing.titlePt || listing.titleEn || listing.title,
      description: (listing.descriptionPt || listing.descriptionEn || listing.description || '')
        .replace(/\s+/g, ' ').trim().slice(0, 500),
      image: listing.images?.length ? listing.images : [image],
      category: listing.category,
      url: canonical,
      offers: offer,
    };

    const brandFromSpecs = listing.specifications?.find(s => /^(brand|marca)$/i.test(s.key))?.value;
    const brandFromAttrs = listing.attributes?.['brand'] ?? listing.attributes?.['make'];
    const brand = (typeof brandFromSpecs === 'string' && brandFromSpecs.trim())
      ? brandFromSpecs.trim()
      : (typeof brandFromAttrs === 'string' && brandFromAttrs.trim() ? brandFromAttrs.trim() : null);
    if (brand) {
      schema['brand'] = { '@type': 'Brand', name: brand };
    }

    if (itemCondition) schema['itemCondition'] = itemCondition;

    // Product snippets recommend review + aggregateRating. We only emit real
    // buyer→seller scores already shown on the listing (never invent ratings).
    const rating = this.buildSellerAggregateRating(listing);
    if (rating) {
      schema['aggregateRating'] = rating.aggregateRating;
      schema['review'] = rating.review;
    }

    this.injectJsonLd('listing-schema', schema);
  }

  /** YYYY-MM-DD for Offer date fields (GSC merchant listings). */
  private toIsoDate(value: string | undefined | null): string | null {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }

  /**
   * Map seller reputation (already public on listing details) into Product
   * aggregateRating + a representative Review so GSC Product snippet checks pass.
   * Unique auction items don't get per-SKU reviews; buyer→seller scores are the
   * only verified signal we have. Omitted when the seller has no reviews yet.
   */
  private buildSellerAggregateRating(listing: Listing): {
    aggregateRating: Record<string, unknown>;
    review: Record<string, unknown>;
  } | null {
    const count = listing.sellerReviewCount ?? 0;
    const score = listing.sellerScore;
    if (count < 1 || typeof score !== 'number' || !Number.isFinite(score) || score <= 0) {
      return null;
    }
    const ratingValue = Math.min(5, Math.max(1, Math.round(score * 10) / 10)).toFixed(1);
    return {
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue,
        reviewCount: String(count),
        bestRating: '5',
        worstRating: '1',
      },
      review: {
        '@type': 'Review',
        author: { '@type': 'Organization', name: 'BidRoom verified buyers' },
        datePublished: this.toIsoDate(listing.updatedAt || listing.createdAt) || undefined,
        reviewRating: {
          '@type': 'Rating',
          ratingValue,
          bestRating: '5',
          worstRating: '1',
        },
      },
    };
  }

  private mapItemCondition(condition: string | undefined): string | null {
    if (!condition) return null;
    const c = condition.toLowerCase().trim();
    if (c === 'new' || c.startsWith('new')) return 'https://schema.org/NewCondition';
    if (c.includes('excellent') || c.includes('like new') || c.includes('like-new')) {
      return 'https://schema.org/UsedCondition';
    }
    if (c.includes('parts') || c.includes('not working') || c.includes('fair')) {
      return 'https://schema.org/DamagedCondition';
    }
    if (c.includes('used') || c.includes('good') || c.includes('very good')) {
      return 'https://schema.org/UsedCondition';
    }
    return 'https://schema.org/UsedCondition';
  }

  /** Maps the seller-chosen return policy to schema.org's MerchantReturnPolicy. Omitted for 'custom' since we don't have fixed terms to declare. */
  private buildReturnPolicy(returnPolicy: string | undefined, country: string): Record<string, unknown> | null {
    if (returnPolicy === 'no-returns') {
      return {
        '@type':               'MerchantReturnPolicy',
        returnPolicyCategory:  'https://schema.org/MerchantReturnNotPermitted',
        applicableCountry:     country,
      };
    }
    if (returnPolicy === '14-days' || returnPolicy === '30-days') {
      return {
        '@type':               'MerchantReturnPolicy',
        returnPolicyCategory:  'https://schema.org/MerchantReturnFiniteReturnWindow',
        merchantReturnDays:    returnPolicy === '14-days' ? 14 : 30,
        applicableCountry:     country,
        returnMethod:          'https://schema.org/ReturnByMail',
        returnFees:            'https://schema.org/ReturnShippingFees',
      };
    }
    // Default for auctions without an explicit policy: no returns.
    return {
      '@type':               'MerchantReturnPolicy',
      returnPolicyCategory:  'https://schema.org/MerchantReturnNotPermitted',
      applicableCountry:     country,
    };
  }

  /**
   * Always returns OfferShippingDetails so Merchant listings don't flag
   * missing shippingDetails. Flat/free use seller values; calculated falls
   * back to a conservative EUR estimate; local pickup is zero-cost same-country.
   */
  private buildShippingDetails(listing: Listing, country: string): Record<string, unknown> {
    const option = listing.shippingOption || 'flat-rate';
    const handlingDays = Math.max(0, listing.handlingTime ?? 5);

    let rate = 0;
    let transitMin = 1;
    let transitMax = 5;

    if (option === 'free' || option === 'local-pickup') {
      rate = 0;
      if (option === 'local-pickup') {
        transitMin = 0;
        transitMax = 0;
      }
    } else if (option === 'flat-rate') {
      rate = typeof listing.shippingCost === 'number' && listing.shippingCost >= 0
        ? listing.shippingCost
        : 15;
    } else {
      // calculated / unknown — declare an upper-bound estimate rather than omit
      rate = typeof listing.shippingCost === 'number' && listing.shippingCost > 0
        ? listing.shippingCost
        : 15;
      transitMax = 7;
    }

    return {
      '@type': 'OfferShippingDetails',
      shippingRate: {
        '@type': 'MonetaryAmount',
        value: rate.toFixed(2),
        currency: 'EUR',
      },
      shippingDestination: {
        '@type': 'DefinedRegion',
        addressCountry: country || 'PT',
      },
      deliveryTime: {
        '@type': 'ShippingDeliveryTime',
        handlingTime: {
          '@type': 'QuantitativeValue',
          minValue: 0,
          maxValue: handlingDays,
          unitCode: 'DAY',
        },
        transitTime: {
          '@type': 'QuantitativeValue',
          minValue: transitMin,
          maxValue: transitMax,
          unitCode: 'DAY',
        },
      },
    };
  }

  private injectBlogPostSchema(post: BlogPost, image: string, canonical: string, lang: string = 'pt'): void {
    const title = lang === 'en' && post.titleEn ? post.titleEn : post.title;
    const metaDesc = lang === 'en' && post.metaDescriptionEn ? post.metaDescriptionEn : post.metaDescription;
    const excerpt = lang === 'en' && post.excerptEn ? post.excerptEn : post.excerpt;
    const schema = {
      '@context': 'https://schema.org',
      '@type':    'Article',
      headline:    title,
      description: metaDesc || excerpt || undefined,
      image:       [image],
      datePublished: post.publishedAt || post.createdAt,
      dateModified:  post.updatedAt || post.publishedAt || post.createdAt,
      author:  { '@type': 'Organization', name: post.author || 'BidRoom' },
      publisher: {
        '@type': 'Organization',
        name: 'BidRoom',
        logo: { '@type': 'ImageObject', url: `${BASE_URL}/favicon.svg` },
      },
      mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    };
    this.injectJsonLd('blogpost-schema', schema);
  }

  private injectJsonLd(id: string, schema: object): void {
    this.doc.getElementById(id)?.remove();
    const script = this.doc.createElement('script');
    script.id   = id;
    script.type = 'application/ld+json';
    script.text = JSON.stringify(schema);
    this.doc.head.appendChild(script);
  }

  private removeJsonLd(id: string): void {
    this.doc.getElementById(id)?.remove();
  }
}
