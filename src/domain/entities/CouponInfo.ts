/**
 * Information extracted from a product page's coupon link.
 * `promotionMerchantId` is kept as a separate field from `redirectMerchantId`
 * because the POST payload uses both, and they may diverge across different coupons.
 *
 * When `isIndividual === true`, the coupon is an inline "individual" coupon shown directly
 * on the product page (not a PSP coupon with its own `/promotion/psp/` page). In this case,
 * the optional metadata fields (discountText, description, termsUrl) are populated.
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
  /**
   * Discriminant: set to `true` when this coupon is an "individual" coupon
   * (inline promotion shown directly on the product page, not a PSP coupon).
   * `undefined` when this is a PSP-style coupon.
   */
  isIndividual?: true;
  /**
   * Discount text extracted from the badge element (e.g. "R$20", "20%").
   * Present only when `isIndividual === true`. `null` when badge is not found.
   */
  discountText?: string | null;
  /**
   * Human-readable message shown in the inline block (normalised text),
   * without the leading "off." prefix.
   * Present only when `isIndividual === true`. `null` when message is empty.
   */
  description?: string | null;
  /**
   * Relative URL of the popover endpoint that serves the coupon terms
   * (e.g. "/promotion/details/popup/ATVO4IBO0PTIE?ref=cxcw_bxgx_tc_...").
   * Present only when `isIndividual === true`. `null` when the modal attribute is absent.
   */
  termsUrl?: string | null;
  /**
   * Discriminant: set to `true` when this coupon is an "applicable" coupon
   * (pattern "Aplicar cupom de X%" without specific coupon code).
   * Present only when the coupon is both individual and applicable.
   */
  isApplicable?: boolean;
  /**
   * Discount percentage extracted from "Aplicar cupom de X%" pattern.
   * Present only when `isApplicable === true`. `null` when parsing fails.
   */
  discountPercent?: number | null;
  /**
   * URL of the participating products page for applicable coupons.
   * Present only when `isApplicable === true`. `null` when not found or not applicable.
   */
  participatingProductsUrl?: string | null;
}
