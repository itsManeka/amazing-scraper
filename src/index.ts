export { Product, CouponInfo, CouponMetadata, CouponResult, ExtractCouponProductsResult, ProductPage } from './domain/entities';
export { ScraperError, ScraperErrorCode, ScraperErrorOptions } from './domain/errors';
export { HttpClient, HttpResponse } from './application/ports/HttpClient';
export { Logger } from './application/ports/Logger';
export { RetryPolicy, RetryContext, RetryDecision, RetryErrorType } from './application/ports/RetryPolicy';
export { UserAgentProvider } from './application/ports/UserAgentProvider';
export type { PaginationLimits } from './application/use-cases/ExtractCouponProducts';

import { ExtractCouponProducts, DelayConfig, PaginationLimits } from './application/use-cases/ExtractCouponProducts';
import { FetchProduct } from './application/use-cases/FetchProduct';
import { HttpClient } from './application/ports/HttpClient';
import { RetryPolicy } from './application/ports/RetryPolicy';
import { UserAgentProvider } from './application/ports/UserAgentProvider';
import { AxiosHttpClient } from './infrastructure/http/AxiosHttpClient';
import { RotatingUserAgentProvider } from './infrastructure/http/RotatingUserAgentProvider';
import { ExponentialBackoffRetry } from './infrastructure/retry/ExponentialBackoffRetry';
import { CheerioHtmlParser } from './infrastructure/parsers/CheerioHtmlParser';
import { ConsoleLogger } from './infrastructure/logger/ConsoleLogger';
import { Logger } from './application/ports/Logger';
import { ScraperError } from './domain/errors';
import { CouponInfo, CouponResult, ProductPage } from './domain/entities';

/**
 * Configuration options for the scraper factory.
 */
export interface ScraperOptions {
  /** Random delay range between requests (default: { min: 1000, max: 2000 }) */
  delayMs?: DelayConfig;
  /** Custom logger implementation (default: ConsoleLogger with JSON output) */
  logger?: Logger;
  /** Pagination safety limits to prevent runaway extraction */
  paginationLimits?: PaginationLimits;
  /** Custom User-Agent provider (default: RotatingUserAgentProvider) */
  userAgentProvider?: UserAgentProvider;
  /** Custom retry policy (default: ExponentialBackoffRetry with 3 retries) */
  retryPolicy?: RetryPolicy;
  /** Callback invoked before throwing on block/CAPTCHA/session errors. */
  onBlocked?: (error: ScraperError) => Promise<void>;
  /** Custom HTTP client (default: AxiosHttpClient with cookie jar) */
  httpClient?: HttpClient;
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
 *   console.log(result.metadata?.title, result.metadata?.expiresAt);
 *   console.log(result.products);
 * }
 * ```
 */
export function createScraper(options?: ScraperOptions): AmazonCouponScraper {
  const logger = options?.logger ?? new ConsoleLogger();
  const httpClient = options?.httpClient ?? new AxiosHttpClient(logger);
  const htmlParser = new CheerioHtmlParser();
  const userAgentProvider = options?.userAgentProvider ?? new RotatingUserAgentProvider();
  const retryPolicy = options?.retryPolicy ?? new ExponentialBackoffRetry();
  const onBlocked = options?.onBlocked;

  const extractCouponUseCase = new ExtractCouponProducts(
    httpClient, htmlParser, logger, userAgentProvider, retryPolicy, onBlocked,
    options?.delayMs, options?.paginationLimits,
  );
  const fetchProductUseCase = new FetchProduct(
    httpClient, htmlParser, logger, userAgentProvider, retryPolicy, onBlocked,
  );

  return {
    fetchProduct: (asin: string) => fetchProductUseCase.execute(asin),
    extractCouponProducts: (couponInfo: CouponInfo) => extractCouponUseCase.execute(couponInfo),
  };
}
