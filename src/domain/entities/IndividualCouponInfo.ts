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
   * Discount text extracted from the badge element adjacent to promoMessageCXCW
   * (e.g. "R$20", "20%"). `null` when the badge element is not found.
   */
  discountText: string | null;
  /**
   * Human-readable message shown in the inline block (normalised text),
   * without the leading "off." prefix. `null` when the message container is empty.
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
  /**
   * Indicates whether this coupon is an "applicable" coupon (pattern: "Aplicar cupom de X%").
   * Applicable coupons are generic promotional discounts without a dedicated coupon code
   * in the product page (the code, if any, is on the promotion's PSP page — extracted by F03 if needed).
   * `true` only for applicable pattern; `undefined` or absent in classic "Insira o código" flow.
   */
  isApplicable?: boolean;
  /**
   * URL to the participating products page for applicable coupons (link labeled "Ver Itens Participantes" in PT-BR).
   * `null` when the link is not present (e.g., some applicable coupons like coupon-03 have no participating products list).
   * `undefined` or absent in classic "Insira o código" flow.
   *
   * @untrusted Value extracted from public HTML on the Amazon website. Always validate via SSRF guard
   * (allow-list of hostname amazon.com.br, https-only) before performing any fetch operation.
   */
  participatingProductsUrl?: string | null;
  /**
   * Discount percentage extracted from "Aplicar cupom de X%" text for applicable coupons (e.g., 10 from "Aplicar cupom de 10%").
   * Integer from 1-99. `null` when the regex fails to extract (defensive; not expected in known fixtures).
   * `undefined` or absent in classic "Insira o código" flow.
   */
  discountPercent?: number | null;
}
