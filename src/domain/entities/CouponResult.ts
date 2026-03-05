import { Product } from './Product';

/**
 * Final structured result of a coupon product extraction.
 */
export interface CouponResult {
  promotionId: string;
  sourceAsin: string;
  totalProducts: number;
  products: Product[];
}

/**
 * Discriminated union returned by the use case.
 * - `found: false` — the source ASIN has no active coupon.
 * - `found: true`  — coupon found; `result` contains all products.
 */
export type ExtractCouponProductsResult =
  | { found: false; sourceAsin: string }
  | { found: true; result: CouponResult };
