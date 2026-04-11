/**
 * Information extracted from a product page's coupon link.
 * `promotionMerchantId` is kept as a separate field from `redirectMerchantId`
 * because the POST payload uses both, and they may diverge across different coupons.
 */
export interface CouponInfo {
  promotionId: string;
  redirectAsin: string;
  redirectMerchantId: string;
  promotionMerchantId: string;
  /**
   * Alphanumeric coupon code extracted from the product page text
   * (e.g. "FJOVKLWWIZXM" from "com o cupom FJOVKLWWIZXM").
   * `null` when no code is found in the surrounding text.
   */
  couponCode: string | null;
}
