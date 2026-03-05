export { Product, CouponInfo, CouponResult, ExtractCouponProductsResult, ProductPage } from './domain/entities';
export { ScraperError, ScraperErrorCode } from './domain/errors';
export { Logger } from './application/ports/Logger';

import { ExtractCouponProducts, DelayConfig } from './application/use-cases/ExtractCouponProducts';
import { FetchProduct } from './application/use-cases/FetchProduct';
import { AxiosHttpClient } from './infrastructure/http/AxiosHttpClient';
import { CheerioHtmlParser } from './infrastructure/parsers/CheerioHtmlParser';
import { ConsoleLogger } from './infrastructure/logger/ConsoleLogger';
import { Logger } from './application/ports/Logger';
import { CouponInfo, CouponResult, ProductPage } from './domain/entities';

/**
 * Configuration options for the scraper factory.
 */
export interface ScraperOptions {
  /** Random delay range between requests (default: { min: 1000, max: 2000 }) */
  delayMs?: DelayConfig;
  /** Custom logger implementation (default: ConsoleLogger with JSON output) */
  logger?: Logger;
}

/**
 * Public scraper interface returned by `createScraper`.
 */
export interface AmazonCouponScraper {
  /**
   * Fetches a single product page and returns its structured data.
   * Does not follow coupon links or paginate.
   */
  fetchProduct(asin: string): Promise<ProductPage>;
  /**
   * Extracts all products participating in a coupon promotion.
   * Requires `CouponInfo` previously obtained from `fetchProduct`.
   */
  extractCouponProducts(couponInfo: CouponInfo): Promise<CouponResult>;
}

/**
 * Factory function to create an Amazon coupon scraper instance.
 *
 * @example
 * ```typescript
 * import { createScraper } from 'amazing-scraper';
 *
 * const scraper = createScraper({ delayMs: { min: 1500, max: 3000 } });
 *
 * // Step 1: Fetch the product page
 * const page = await scraper.fetchProduct('B0EXAMPLE1');
 * console.log(page.title, page.price, page.hasCoupon);
 *
 * // Step 2: Extract coupon products (only if coupon exists)
 * if (page.hasCoupon && page.couponInfo) {
 *   const result = await scraper.extractCouponProducts(page.couponInfo);
 *   console.log(result.products);
 * }
 * ```
 */
export function createScraper(options?: ScraperOptions): AmazonCouponScraper {
  const logger = options?.logger ?? new ConsoleLogger();
  const httpClient = new AxiosHttpClient(logger);
  const htmlParser = new CheerioHtmlParser();
  const extractCouponUseCase = new ExtractCouponProducts(httpClient, htmlParser, logger, options?.delayMs);
  const fetchProductUseCase = new FetchProduct(httpClient, htmlParser, logger);

  return {
    fetchProduct: (asin: string) => fetchProductUseCase.execute(asin),
    extractCouponProducts: (couponInfo: CouponInfo) => extractCouponUseCase.execute(couponInfo),
  };
}
