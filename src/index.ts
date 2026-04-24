export { Product, CouponInfo, CouponMetadata, CouponResult, ExtractCouponProductsResult, IndividualCouponInfo, ProductPage, FetchPreSalesResult, ScrapedAmazonProduct } from './domain/entities';
export { ScraperError, ScraperErrorCode, ScraperErrorOptions } from './domain/errors';
export { toAmazonProduct, parseAmazonPrice } from './domain/mappers/toAmazonProduct';
export { normalizeAmazonImageUrl } from './infrastructure/parsers/CheerioHtmlParser';
export { isDegradedProductPage } from './infrastructure/parsers/isDegradedProductPage';
export { HttpClient, HttpGetOptions, HttpResponse } from './application/ports/HttpClient';
export { Logger } from './application/ports/Logger';
export { RetryPolicy, RetryContext, RetryDecision, RetryErrorType } from './application/ports/RetryPolicy';
export { UserAgentProvider } from './application/ports/UserAgentProvider';
export type { PaginationLimits, DelayConfig } from './application/use-cases/ExtractCouponProducts';
export type { FetchPreSalesOptions } from './application/use-cases/FetchPreSales';
export type { ApplicableCouponResult } from './application/use-cases/ExtractApplicableCouponProducts';

import { ExtractCouponProducts, DelayConfig, PaginationLimits } from './application/use-cases/ExtractCouponProducts';
import { ExtractApplicableCouponProducts, ApplicableCouponResult } from './application/use-cases/ExtractApplicableCouponProducts';
import { FetchProduct } from './application/use-cases/FetchProduct';
import { FetchPreSales } from './application/use-cases/FetchPreSales';
import { FetchIndividualCouponTerms } from './application/use-cases/FetchIndividualCouponTerms';
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
import { CouponInfo, CouponResult, FetchPreSalesResult, ProductPage, IndividualCouponInfo } from './domain/entities';
import { FetchPreSalesOptions } from './application/use-cases/FetchPreSales';
import { SessionRecycler } from './application/services/SessionRecycler';

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
  /**
   * Session recycling configuration for preventing session degradation over multiple requests.
   * Default behavior includes preventive recycling (every 5 requests) and reactive degrade detection.
   *
   * @example
   * // Enable with defaults (preventive: every 5 requests, reactive: true)
   * const scraper = createScraper({ sessionRecycle: {} });
   *
   * // Custom preventive interval (recycle every 10 requests)
   * const scraper = createScraper({ sessionRecycle: { afterRequests: 10 } });
   *
   * // Disable reactive detection, keep preventive recycling
   * const scraper = createScraper({ sessionRecycle: { reactive: false } });
   *
   * // Disable all recycling (legacy mode)
   * const scraper = createScraper({ sessionRecycle: { afterRequests: 0, reactive: false } });
   *
   * // Or omit sessionRecycle entirely for defaults (recommended)
   * const scraper = createScraper();
   */
  sessionRecycle?: {
    /**
     * Recycle session (reset cookies, create new jar) after this many successful requests.
     * Default: 5. Set to 0 to disable preventive recycling.
     */
    afterRequests?: number;
    /**
     * Enable reactive degrade detection on FetchProduct.
     * When enabled, if a product page appears degraded (200 OK but missing critical data),
     * the session is automatically reset and the request retried once.
     * Default: true. Set to false to disable.
     */
    reactive?: boolean;
  };
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
  /**
   * Fetches pre-sale ASINs from the Amazon HQ & Manga search page.
   * Paginates and stops based on page limit or stop-ASIN sentinel.
   */
  fetchPreSales(options?: FetchPreSalesOptions): Promise<FetchPreSalesResult>;
  /**
   * Fetches the terms text of an "individual" coupon from the Amazon
   * popover endpoint (`/promotion/details/popup/{PROMOTION_ID}`).
   *
   * Accepts the relative or absolute URL exposed by
   * `IndividualCouponInfo.termsUrl`. The resolved hostname is pinned to
   * `www.amazon.com.br` to mitigate SSRF. Returns `null` on network
   * failure, non-200 response, foreign-host URL, or when the terms
   * selector is absent.
   */
  fetchIndividualCouponTerms(termsUrl: string): Promise<string | null>;
  /**
   * Extracts products participating in an applicable coupon (pattern: "Aplicar cupom de X%").
   * Requires `IndividualCouponInfo` with `isApplicable === true` previously obtained from `fetchProduct`.
   *
   * Two flows:
   * - **Coupon-03** (no participating products page): returns `{ asins: [sourceAsin], expiresAt }` only.
   * - **Coupon-04** (with participating products page): fetches the page, paginates through products,
   *   and returns all participating ASINs or falls back to `[sourceAsin]` if none found.
   *
   * Always extracts expiration date from coupon terms (via `fetchIndividualCouponTerms`).
   *
   * @example
   * ```typescript
   * if (page.individualCouponInfo?.isApplicable) {
   *   const result = await scraper.extractApplicableCouponProducts(
   *     page.individualCouponInfo,
   *     page.asin,
   *   );
   *   console.log(result.asins, result.expiresAt);
   * }
   * ```
   */
  extractApplicableCouponProducts(
    couponInfo: IndividualCouponInfo,
    sourceAsin: string,
  ): Promise<ApplicableCouponResult>;
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

  // T6: Resolve session recycling options with defaults
  const sessionRecycleConfig = options?.sessionRecycle ?? {};
  const afterRequests = sessionRecycleConfig.afterRequests ?? 5; // Default: 5 requests
  const reactive = sessionRecycleConfig.reactive ?? true; // Default: true

  // Instantiate single shared SessionRecycler (one per scraper instance)
  // If afterRequests is 0, SessionRecycler remains inert (legacy mode)
  const sessionRecycler = new SessionRecycler(httpClient, afterRequests, logger);

  const extractCouponUseCase = new ExtractCouponProducts(
    httpClient, htmlParser, logger, userAgentProvider, retryPolicy, onBlocked,
    options?.delayMs, options?.paginationLimits,
    sessionRecycler,
  );
  const fetchProductUseCase = new FetchProduct(
    httpClient, htmlParser, logger, userAgentProvider, retryPolicy, onBlocked,
    sessionRecycler,
    reactive,
  );
  const fetchPreSalesUseCase = new FetchPreSales(
    httpClient, htmlParser, logger, userAgentProvider, retryPolicy, onBlocked,
    options?.delayMs,
    sessionRecycler,
  );
  const fetchIndividualCouponTermsUseCase = new FetchIndividualCouponTerms(
    httpClient, htmlParser, logger, userAgentProvider,
  );
  const extractApplicableCouponUseCase = new ExtractApplicableCouponProducts(
    httpClient, htmlParser, logger, userAgentProvider, retryPolicy, fetchIndividualCouponTermsUseCase, onBlocked,
    options?.delayMs, options?.paginationLimits,
    sessionRecycler,
  );

  return {
    fetchProduct: (asin: string) => fetchProductUseCase.execute(asin),
    extractCouponProducts: (couponInfo: CouponInfo) => extractCouponUseCase.execute(couponInfo),
    fetchPreSales: (opts?: FetchPreSalesOptions) => fetchPreSalesUseCase.execute(opts),
    fetchIndividualCouponTerms: (termsUrl: string) =>
      fetchIndividualCouponTermsUseCase.execute(termsUrl),
    extractApplicableCouponProducts: (couponInfo: IndividualCouponInfo, sourceAsin: string) =>
      extractApplicableCouponUseCase.execute(couponInfo, sourceAsin),
  };
}
