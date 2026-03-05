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
}
