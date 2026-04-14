/**
 * Information extracted from an inline "individual" coupon shown on the product
 * page (not a coupon with a dedicated `/promotion/psp/` page and participating
 * product list).
 *
 * The coupon is exposed in the product HTML inside
 * `#promoPriceBlockMessage_feature_div` via a
 * `[data-csa-c-owner="PromotionsDiscovery"]` container whose
 * `data-csa-c-item-id` encodes the promotion id. The "Termos" link opens a
 * popover whose content is fetched via AJAX from the URL embedded in the
 * `data-a-modal` JSON attribute.
 *
 * Individual coupons are never linked to any product — including the one
 * where they were discovered — and must not be used for price calculation.
 */
export interface IndividualCouponInfo {
  /**
   * Promotion id extracted from `amzn1.promotion.{ID}` in the
   * `data-csa-c-item-id` attribute (e.g. "ATVO4IBO0PTIE").
   */
  promotionId: string;
  /**
   * Alphanumeric coupon code shown in the inline message
   * (e.g. "VEMNOAPP" from "Insira o código VEMNOAPP na hora do pagamento").
   * `null` when no code is found.
   */
  couponCode: string | null;
  /**
   * Full human-readable message shown in the inline block (normalised text).
   * `null` when the message container is empty.
   */
  description: string | null;
  /**
   * Relative URL of the popover endpoint that serves the coupon terms
   * (e.g. "/promotion/details/popup/ATVO4IBO0PTIE?ref=cxcw_bxgx_tc_...").
   * Extracted from the `data-a-modal` JSON attribute of the "Termos" link
   * container. `null` when the modal attribute is absent or invalid.
   */
  termsUrl: string | null;
  /** Discriminant to distinguish from `CouponInfo`. Always `true`. */
  isIndividual: true;
}
