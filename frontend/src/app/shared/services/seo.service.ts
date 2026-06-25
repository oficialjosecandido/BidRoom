import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { DOCUMENT } from '@angular/common';
import { Listing } from './listings.service';
import { BlogPost } from './blog.service';

const BASE_URL   = 'https://www.bidroom.pt';
const DEFAULT_OG = `${BASE_URL}/og-image.png`;

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
    this.injectBlogPostSchema(post, image, canonical, lang);
  }

  resetToDefault(): void {
    this.setDefault();
    this.removeCanonical();
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
    const price     = listing.currentPrice ?? listing.startingPrice;
    const priceStr  = fmtEur(price);
    const format    = listing.auctionFormat === 'best-offer' ? 'Melhor Proposta' : 'Leilão';
    const cta       = `${format} a partir de ${priceStr}. Lance já.`;

    if (!cleanDesc) return cta;

    const budget = 155 - 3 - cta.length; // 3 for " — "
    const snippet = cleanDesc.length > budget
      ? `${cleanDesc.slice(0, budget - 1)}…`
      : cleanDesc;

    return `${snippet} — ${cta}`;
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

    this.meta.updateTag({ name: 'twitter:title',       content: p.title });
    this.meta.updateTag({ name: 'twitter:description', content: p.description });
    this.meta.updateTag({ name: 'twitter:image',       content: p.image });
    this.meta.updateTag({ name: 'twitter:card',        content: 'summary_large_image' });
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
    const price = listing.currentPrice ?? listing.startingPrice;
    const sellerName = listing.seller
      ? `${listing.seller.firstName} ${listing.seller.lastName}`.trim()
      : undefined;
    const country = listing.locationCountry || 'PT';

    const offer: Record<string, unknown> = {
      '@type':        'Offer',
      priceCurrency:  'EUR',
      price:          price.toFixed(2),
      availability:   listing.status === 'active'
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      url:            canonical,
      ...(listing.endDate && { priceValidUntil: listing.endDate.slice(0, 10) }),
      ...(sellerName && {
        seller: { '@type': 'Person', name: sellerName },
      }),
    };

    const returnPolicy = this.buildReturnPolicy(listing.returnPolicy, country);
    if (returnPolicy) offer['hasMerchantReturnPolicy'] = returnPolicy;

    const shippingDetails = this.buildShippingDetails(listing, country);
    if (shippingDetails) offer['shippingDetails'] = shippingDetails;

    const schema: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type':    'Product',
      name:        listing.titlePt || listing.titleEn || listing.title,
      description: (listing.descriptionPt || listing.descriptionEn || listing.description || '')
        .replace(/\s+/g, ' ').trim().slice(0, 500),
      image:       listing.images?.length ? listing.images : [image],
      category:    listing.category,
      url:         canonical,
      offers:      offer,
    };

    const brand = listing.specifications?.find(s => /^(brand|marca)$/i.test(s.key))?.value;
    if (brand) schema['brand'] = { '@type': 'Brand', name: brand };

    if (listing.condition) {
      const condMap: Record<string, string> = {
        new:          'https://schema.org/NewCondition',
        like_new:     'https://schema.org/LikeNewCondition',
        'like-new':   'https://schema.org/LikeNewCondition',
        good:         'https://schema.org/UsedCondition',
        used:         'https://schema.org/UsedCondition',
        fair:         'https://schema.org/DamagedCondition',
        for_parts:    'https://schema.org/DamagedCondition',
      };
      const mapped = condMap[listing.condition.toLowerCase()];
      if (mapped) schema['itemCondition'] = mapped;
    }

    this.injectJsonLd('listing-schema', schema);
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
    return null;
  }

  /**
   * Maps the seller-chosen shipping option to schema.org's OfferShippingDetails.
   * Omitted for 'calculated' (real-time carrier rates vary per buyer) and
   * 'local-pickup' (nothing is shipped) — declaring a fixed rate there would be inaccurate.
   */
  private buildShippingDetails(listing: Listing, country: string): Record<string, unknown> | null {
    if (listing.shippingOption !== 'flat-rate' && listing.shippingOption !== 'free') return null;

    const rate = listing.shippingOption === 'free' ? 0 : (listing.shippingCost ?? 0);
    const handlingDays = listing.handlingTime ?? 5;

    return {
      '@type': 'OfferShippingDetails',
      shippingRate: { '@type': 'MonetaryAmount', value: rate.toFixed(2), currency: 'EUR' },
      shippingDestination: { '@type': 'DefinedRegion', addressCountry: country },
      deliveryTime: {
        '@type': 'ShippingDeliveryTime',
        handlingTime:  { '@type': 'QuantitativeValue', minValue: 0, maxValue: handlingDays, unitCode: 'DAY' },
        transitTime:   { '@type': 'QuantitativeValue', minValue: 1, maxValue: 5, unitCode: 'DAY' },
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
