import { CouponMetadata } from './CouponMetadata';
import { Product } from './Product';

/**
 * Final structured result of a coupon product extraction.
 */
export interface CouponResult {
  promotionId: string;
  totalProducts: number;
  products: Product[];
  /** Coupon promotion metadata (title, description, expiration). */
  metadata?: CouponMetadata;
}

/**
 * Discriminated union returned by the use case.
 * - `found: false` — the promotion has no active coupon.
 * - `found: true`  — coupon found; `result` contains all products.
 */
export type ExtractCouponProductsResult =
  | { found: false }
  | { found: true; result: CouponResult };
