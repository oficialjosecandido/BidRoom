import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { DOCUMENT } from '@angular/common';
import { Listing } from './listings.service';

const BASE_URL   = 'https://www.bidroom.pt';
const DEFAULT_OG = `${BASE_URL}/og-image.svg`;

const DEFAULTS = {
  title:       'BidRoom — Leilões Premium',
  description: 'Compra e vende artigos únicos através de leilões em tempo real, Melhor Proposta ou Sala Privada. Pagamentos seguros, payouts directos.',
  url:         BASE_URL,
  image:       DEFAULT_OG,
};

@Injectable({ providedIn: 'root' })
export class SeoService {
  private meta  = inject(Meta);
  private title = inject(Title);
  private doc   = inject(DOCUMENT);

  setDefault(): void {
    this.apply(DEFAULTS);
  }

  /**
   * Sets OG/Twitter tags for a listing page.
   *
   * - Title:       "BidRoom - [EN title preferred]"
   * - Description: "[description snippet, ≤120 chars] Bid Now"
   * - Image:       first listing image, falling back to the default OG image
   * - URL:         backendShareUrl (OG-rich HTML for crawlers) or canonical
   */
  setListing(listing: Listing, backendShareUrl?: string): void {
    const canonical = `${BASE_URL}/listing/${listing.slug}`;

    const rawTitle = listing.titleEn || listing.title || '';
    const rawDesc  = (listing.descriptionEn || listing.description || '').replace(/\s+/g, ' ').trim();
    const snippet  = rawDesc.length > 120 ? `${rawDesc.slice(0, 117)}…` : rawDesc;

    this.apply({
      title:       `BidRoom - ${rawTitle}`,
      description: snippet ? `${snippet} Bid Now` : 'Bid Now',
      url:         backendShareUrl || canonical,
      image:       listing.images?.[0] || DEFAULT_OG,
    });

    this.setCanonical(canonical);
  }

  resetToDefault(): void {
    this.setDefault();
    this.removeCanonical();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private apply(p: { title: string; description: string; url: string; image: string }): void {
    this.title.setTitle(p.title);

    // Standard
    this.meta.updateTag({ name: 'description', content: p.description });

    // OG
    this.meta.updateTag({ property: 'og:title',       content: p.title });
    this.meta.updateTag({ property: 'og:description', content: p.description });
    this.meta.updateTag({ property: 'og:url',         content: p.url });
    this.meta.updateTag({ property: 'og:image',       content: p.image });
    this.meta.updateTag({ property: 'og:type',        content: 'website' });

    // Twitter
    this.meta.updateTag({ name: 'twitter:title',       content: p.title });
    this.meta.updateTag({ name: 'twitter:description', content: p.description });
    this.meta.updateTag({ name: 'twitter:image',       content: p.image });
    this.meta.updateTag({ name: 'twitter:card',        content: 'summary_large_image' });
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
    const link = this.doc.querySelector('link[rel="canonical"]');
    if (link) link.remove();
  }
}
