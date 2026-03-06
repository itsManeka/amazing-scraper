import { CouponInfo } from './CouponInfo';

/**
 * Represents the data extracted from a single Amazon product detail page.
 */
export interface ProductPage {
  /** The product's ASIN identifier. */
  asin: string;
  /** Product title extracted from the page. */
  title: string;
  /** Current selling price as a formatted string (e.g. "R$ 99,90"). */
  price: string;
  /** Original/list price before discounts (empty string if not available). */
  originalPrice: string;
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
