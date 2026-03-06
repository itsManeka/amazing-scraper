/**
 * Metadata extracted from an Amazon coupon promotion page.
 * All fields are nullable because the Amazon page may not always
 * display description or expiration date.
 */
export interface CouponMetadata {
  /** Promotion title (e.g. "Só no app: 20% off em itens Brinox"). */
  title: string | null;
  /** Additional description or badge (e.g. "Exclusivo para membros Prime"). */
  description: string | null;
  /** Expiration date as displayed on the page (e.g. "domingo 15 de março de 2026"). */
  expiresAt: string | null;
}
