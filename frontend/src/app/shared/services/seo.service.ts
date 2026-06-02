import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { DOCUMENT } from '@angular/common';
import { Listing } from './listings.service';

const BASE_URL   = 'https://www.bidroom.pt';
const DEFAULT_OG = `${BASE_URL}/og-image.svg`;

const DEFAULTS = {
  title:       'BidRoom — Leilões Premium em Portugal',
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

  setListing(listing: Listing, backendShareUrl?: string): void {
    const image     = listing.images?.[0] || DEFAULT_OG;
    const priceStr  = this.formatPrice(listing);
    const condition = listing.condition ? ` · ${listing.condition}` : '';
    const canonical = `${BASE_URL}/listing/${listing.slug}`;

    this.apply({
      title:       `${listing.title} — BidRoom`,
      description: `${priceStr}${condition}. ${this.formatFormat(listing)} ${this.formatTime(listing)}. Compra segura com escrow BidRoom.`,
      url:         backendShareUrl || canonical,
      image,
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
    if (link) link.setAttribute('href', BASE_URL + '/');
  }

  private formatPrice(listing: Listing): string {
    const price = listing.currentPrice || listing.startingPrice || 0;
    return `€${price.toLocaleString('pt-PT', { minimumFractionDigits: 0 })}`;
  }

  private formatFormat(listing: Listing): string {
    if (listing.auctionFormat === 'best-offer') return 'Melhor Proposta.';
    return 'Leilão em tempo real.';
  }

  private formatTime(listing: Listing): string {
    if (!listing.endDate) return '';
    const ms   = new Date(listing.endDate).getTime() - Date.now();
    if (ms <= 0) return 'Encerrado.';
    const h    = Math.floor(ms / 3_600_000);
    if (h < 24) return `${h}h restantes.`;
    const d    = Math.floor(h / 24);
    return `${d} dias restantes.`;
  }
}
