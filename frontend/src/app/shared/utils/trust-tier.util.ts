export interface TrustTierInfo {
  tier: number;
  label: string;
  labelPt: string;
  cssClass: string;
  icon: string;
  sellerNote: string;
}

export function getTrustTierInfo(tier: number): TrustTierInfo {
  switch (tier) {
    case 3:
      return {
        tier: 3,
        label: 'Payment Guaranteed',
        labelPt: 'Pagamento Garantido',
        cssClass: 'trust-tier-3',
        icon: '🛡️',
        sellerNote: 'Compensação automática em caso de disputa',
      };
    case 2:
      return {
        tier: 2,
        label: 'Identity Verified',
        labelPt: 'Identidade Verificada',
        cssClass: 'trust-tier-2',
        icon: '🪪',
        sellerNote: 'Identidade conhecida — responsabilização legal possível',
      };
    default:
      return {
        tier: 1,
        label: 'Verified',
        labelPt: 'Verificado',
        cssClass: 'trust-tier-1',
        icon: '📧',
        sellerNote: 'Sem garantia adicional',
      };
  }
}
