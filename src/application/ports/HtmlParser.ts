import { CouponInfo, CouponMetadata, ProductPage } from '../../domain/entities';
import { Logger } from './Logger';

/**
 * Port for parsing Amazon HTML pages.
 */
export interface HtmlParser {
  /**
   * Extracts coupon promotion data from a product detail page.
   * Returns `null` when no coupon link is found.
   */
  extractCouponInfo(html: string): CouponInfo | null;

  /**
   * Extracts the anti-CSRF token from a coupon promotion page.
   * Returns `null` when no token is found.
   */
  extractCsrfToken(html: string): string | null;

  /**
   * Extracts coupon metadata (title, description, expiration) from a coupon promotion page.
   * Always returns a `CouponMetadata` object; absent fields are `null`.
   */
  extractCouponMetadata(html: string): CouponMetadata;

  /**
   * Extracts structured product data from a product detail page.
   * @param html - Raw HTML of the product page
   * @param asin - The ASIN used to fetch the page
   * @param url - The canonical URL of the page
   * @param logger - Optional logger for emitting warnings on unrecognized availability text
   */
  extractProductInfo(html: string, asin: string, url: string, logger?: Logger): ProductPage;
}
