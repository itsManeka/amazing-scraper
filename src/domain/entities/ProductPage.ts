import { CouponInfo } from './CouponInfo';
import { IndividualCouponInfo } from './IndividualCouponInfo';

/**
 * Represents the data extracted from a single Amazon product detail page.
 */
export interface ProductPage {
  /** The product's ASIN identifier. */
  asin: string;
  /** Product title extracted from the page. */
  title: string;
  /**
   * Current selling price as a formatted string (e.g. "R$ 99,90"), or `null` when the
   * price selector did not find any value on the page.
   * `null` means the scraper could not determine a price — it does NOT mean the product is
   * free. A string value of `'R$ 0,00'` represents a legitimately free product (e.g. ebooks).
   */
  price: string | null;
  /**
   * Original/list price before discounts (e.g. "R$ 149,90"), or `null` when the selector
   * did not find a value on the page.
   */
  originalPrice: string | null;
  /** Whether the product is eligible for Amazon Prime shipping. */
  prime: boolean;
  /** Average customer rating (0–5). */
  rating: number;
  /** Total number of customer reviews. */
  reviewCount: number;
  /** Whether a coupon promotion was found on this page. */
  hasCoupon: boolean;
  /** Coupon promotion details, or `null` when no coupon is present. */
  couponInfo: CouponInfo | null;
  /**
   * Array of all coupons discovered on the product page.
   * Populated via `extractAllCoupons` to capture multiple PSP/individual coupons
   * on the same PDP. Empty array `[]` when no coupons are present.
   * Aditivo field (F08, Opcao C) — does not break legacy `couponInfo` singular.
   */
  couponInfos: CouponInfo[];
  /**
   * Inline "individual" coupon details discovered on the product page when no
   * PSP-style coupon was found. Populated only when `couponInfo` is `null` and
   * the page renders a `PromotionsDiscovery` block with a "Termos" popover.
   * `null` when no individual coupon is present.
   *
   * Individual coupons do not vinculate to any product and are never used for
   * price calculation — they are persisted as standalone coupons (see F17).
   */
  individualCouponInfo?: IndividualCouponInfo | null;
  /** Canonical URL used to fetch this page. */
  url: string;
  /** Merchant ID from the buy-box seller (e.g. "A1ZZFT5FULY4LN" for Amazon BR). */
  offerId?: string;
  /** Whether the product is currently in stock. */
  inStock: boolean;
  /** High-resolution product image URL from the landing image. */
  imageUrl?: string;
  /** Whether the product is available for pre-order only. */
  isPreOrder: boolean;
  /** Product format/binding (e.g. "Capa dura", "Capa Comum", "Kindle"). */
  format?: string;
  /** Publisher name (e.g. "Intrínseca", "Panini"). */
  publisher?: string;
  /** List of contributors with roles (e.g. ["Author Name (Autor)", "Translator (Tradutor)"]). */
  contributors?: string[];
  /** Product group label following PA API DisplayValue convention (e.g. "Book", "DVD", "Video Games"). */
  productGroup?: string;
}
