import { Product, CouponInfo, CouponResult, CouponMetadata } from '../../domain/entities';
import { ScraperError } from '../../domain/errors';
import { AMAZON_BASE_URL, CAPTCHA_MARKERS } from '../../infrastructure/http/amazonConstants';
import { buildGetHeaders, buildPostHeaders } from '../../infrastructure/http/buildHeaders';
import { HttpClient, HttpResponse } from '../ports/HttpClient';
import { HtmlParser } from '../ports/HtmlParser';
import { Logger } from '../ports/Logger';
import { RetryPolicy } from '../ports/RetryPolicy';
import { UserAgentProvider } from '../ports/UserAgentProvider';

export interface DelayConfig {
  min: number;
  max: number;
}

export interface PaginationLimits {
  /** Maximum number of unique products to collect before stopping (default: 1000). */
  maxProducts?: number;
  /** Maximum number of pagination requests before stopping (default: 500). */
  maxPages?: number;
}

interface ProductInfoItem {
  asin: string;
  title: string;
  priceInfo: {
    priceToPay: { displayString: string };
    basicPrice: { displayString: string };
  };
  prime: boolean;
  customerReviewsSummary: {
    rating: number;
    count: number;
  };
  badgeType: string;
  detailPageLink: string;
  sortId: number[];
}

interface ProductInfoListResponse {
  viewModels?: {
    PRODUCT_INFO_LIST?: ProductInfoItem[];
  };
  PRODUCT_INFO_LIST?: ProductInfoItem[];
  reachBottom?: boolean;
}

/**
 * Extracts all products participating in an Amazon coupon promotion.
 * Receives pre-extracted `CouponInfo` and handles CSRF token retrieval and pagination.
 */
export class ExtractCouponProducts {
  private readonly delayConfig: DelayConfig;
  private readonly maxProducts: number;
  private readonly maxPages: number;
  private readonly userAgent: string;

  constructor(
    private readonly httpClient: HttpClient,
    private readonly htmlParser: HtmlParser,
    private readonly logger: Logger,
    userAgentProvider: UserAgentProvider,
    private readonly retryPolicy: RetryPolicy,
    private readonly onBlocked?: (error: ScraperError) => Promise<void>,
    delayConfig?: DelayConfig,
    paginationLimits?: PaginationLimits,
  ) {
    this.delayConfig = delayConfig ?? { min: 1000, max: 2000 };
    this.maxProducts = paginationLimits?.maxProducts ?? 1_000;
    this.maxPages = paginationLimits?.maxPages ?? 500;
    this.userAgent = userAgentProvider.get();
  }

  /**
   * Extracts all products participating in the given coupon promotion.
   *
   * @param couponInfo - Coupon promotion data previously extracted from a product page via `FetchProduct`.
   */
  async execute(couponInfo: CouponInfo): Promise<CouponResult> {
    this.logger.info('Starting coupon extraction', { promotionId: couponInfo.promotionId });

    const productUrl = `${AMAZON_BASE_URL}/dp/${couponInfo.redirectAsin}`;

    const couponPageUrl = this.buildCouponPageUrl(couponInfo);
    const { csrfToken, couponReferer, metadata } = await this.fetchCouponPageData(couponPageUrl, productUrl);

    const products = await this.fetchAllProducts(couponInfo, csrfToken, couponReferer, productUrl);

    this.logger.info('Extraction complete', { totalProducts: products.length });

    return {
      promotionId: couponInfo.promotionId,
      sourceAsin: couponInfo.redirectAsin,
      totalProducts: products.length,
      products,
      metadata,
    };
  }

  private async fetchCouponPageData(
    couponPageUrl: string,
    referer: string,
  ): Promise<{ csrfToken: string; couponReferer: string; metadata: CouponMetadata }> {
    const headers = buildGetHeaders(this.userAgent, referer);
    const response = await this.getWithRetry(couponPageUrl, headers);

    await this.assertNoCaptcha(response);

    if (response.status === 403 || response.status === 503) {
      const error = new ScraperError('blocked', { url: couponPageUrl, status: response.status });
      await this.notifyBlocked(error);
      throw error;
    }


    const csrfToken = this.htmlParser.extractCsrfToken(response.data);
    if (!csrfToken) {
      const error = new ScraperError('csrf_not_found', { url: couponPageUrl });
      await this.notifyBlocked(error);
      throw error;
    }

    const metadata = this.htmlParser.extractCouponMetadata(response.data);

    this.logger.info('CSRF token extracted');
    return { csrfToken, couponReferer: couponPageUrl, metadata };
  }

  private async getWithRetry(url: string, headers: Record<string, string>): Promise<HttpResponse> {
    let attempt = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      await this.randomDelay();

      let response: HttpResponse;
      try {
        response = await this.httpClient.get(url, headers);
      } catch (err) {
        const decision = this.retryPolicy.evaluate({ attempt, statusCode: 0, errorType: 'network' });
        if (decision.shouldRetry) {
          this.logger.warn('Network error on GET, retrying', { url, attempt, delayMs: decision.delayMs });
          await this.delay(decision.delayMs);
          attempt++;
          continue;
        }
        const error = new ScraperError(
          'blocked',
          { url, cause: String(err) },
          { retryable: true, suggestedCooldownMs: 30_000 },
        );
        await this.notifyBlocked(error);
        throw error;
      }

      if (response.status === 403 || response.status === 503) {
        const decision = this.retryPolicy.evaluate({ attempt, statusCode: response.status, errorType: 'http' });
        if (decision.shouldRetry) {
          this.logger.warn(`${response.status} on coupon page, retrying`, { url, attempt, delayMs: decision.delayMs });
          await this.delay(decision.delayMs);
          attempt++;
          continue;
        }
      }

      return response;
    }
  }

  private async fetchAllProducts(
    couponInfo: CouponInfo,
    csrfToken: string,
    couponReferer: string,
    productUrl: string,
  ): Promise<Product[]> {
    const allProducts: Product[] = [];
    const seenAsins = new Set<string>();
    let sortId = '[]';
    let isFirstPageLoad = true;
    let sessionRefreshed = false;
    let pageCount = 0;

    let currentCsrfToken = csrfToken;
    let currentCouponReferer = couponReferer;

    let hasMorePages = true;
    while (hasMorePages) {
      if (pageCount >= this.maxPages) {
        this.logger.warn('Max pages reached, stopping pagination', {
          maxPages: this.maxPages,
          totalProducts: allProducts.length,
        });
        break;
      }

      const payload = this.buildProductListPayload(couponInfo, currentCsrfToken, sortId, isFirstPageLoad);
      const headers = buildPostHeaders(this.userAgent, currentCouponReferer);

      await this.randomDelay();
      let response: HttpResponse;
      try {
        response = await this.httpClient.post(
          `${AMAZON_BASE_URL}/promotion/psp/productInfoList`,
          payload,
          { formEncoded: true },
          headers,
        );
      } catch (err) {
        const decision = this.retryPolicy.evaluate({ attempt: 0, statusCode: 0, errorType: 'network' });
        if (decision.shouldRetry) {
          this.logger.warn('Network error on pagination POST, retrying', { delayMs: decision.delayMs });
          await this.delay(decision.delayMs);
          continue;
        }
        const error = new ScraperError(
          'blocked',
          { phase: 'pagination', cause: String(err) },
          { retryable: true, suggestedCooldownMs: 30_000 },
        );
        await this.notifyBlocked(error);
        throw error;
      }

      pageCount++;

      await this.assertNoCaptcha(response);

      if (response.status === 503) {
        const decision = this.retryPolicy.evaluate({ attempt: 0, statusCode: 503, errorType: 'http' });
        if (decision.shouldRetry) {
          this.logger.warn('503 during pagination, retrying', { delayMs: decision.delayMs });
          await this.delay(decision.delayMs);
          continue;
        }
        const error = new ScraperError(
          'blocked',
          { phase: 'pagination', status: 503 },
          { retryable: true, suggestedCooldownMs: 30_000 },
        );
        await this.notifyBlocked(error);
        throw error;
      }

      if (response.status === 403) {
        this.retryPolicy.evaluate({ attempt: 0, statusCode: 403, errorType: 'session' });

        if (sessionRefreshed) {
          const error = new ScraperError('session_expired', { phase: 'pagination', status: 403 }, { retryable: false });
          await this.notifyBlocked(error);
          throw error;
        }

        this.logger.warn('403 during pagination, refreshing session');
        sessionRefreshed = true;

        const couponPageUrl = this.buildCouponPageUrl(couponInfo);
        const refreshed = await this.fetchCouponPageData(couponPageUrl, productUrl);
        currentCsrfToken = refreshed.csrfToken;
        currentCouponReferer = refreshed.couponReferer;

        continue;
      }

      let parsed: ProductInfoListResponse;
      try {
        parsed = JSON.parse(response.data) as ProductInfoListResponse;
      } catch {
        const error = new ScraperError('blocked', {
          phase: 'pagination',
          reason: 'Invalid JSON response',
        });
        await this.notifyBlocked(error);
        throw error;
      }

      const items = parsed.viewModels?.PRODUCT_INFO_LIST ?? parsed.PRODUCT_INFO_LIST;
      if (!items || items.length === 0) {
        this.logger.info('Pagination complete — empty page received');
        hasMorePages = false;
        continue;
      }

      let newInPage = 0;
      for (const item of items) {
        if (!seenAsins.has(item.asin)) {
          seenAsins.add(item.asin);
          allProducts.push(this.mapProduct(item));
          newInPage++;
        }
      }

      if (newInPage === 0) {
        this.logger.warn('All products in page already seen — API cycling detected, stopping', {
          totalProducts: allProducts.length,
          pageCount,
        });
        break;
      }

      isFirstPageLoad = false;

      if (allProducts.length >= this.maxProducts) {
        this.logger.warn('Max products reached, stopping pagination', {
          maxProducts: this.maxProducts,
          totalProducts: allProducts.length,
        });
        break;
      }

      const lastItem = items[items.length - 1];
      const newSortId = lastItem.sortId?.[0] != null ? `[${lastItem.sortId[0]}]` : '[]';

      if (parsed.reachBottom === true) {
        this.logger.info('Pagination complete — reachBottom flag set', {
          totalSoFar: allProducts.length,
        });
        hasMorePages = false;
        continue;
      }

      if (newSortId !== '[]' && newSortId === sortId) {
        this.logger.warn('sortId loop detected, stopping pagination', { sortId: newSortId });
        hasMorePages = false;
        continue;
      }

      sortId = newSortId;

      this.logger.info('Page fetched', {
        productsInPage: items.length,
        newProducts: newInPage,
        totalSoFar: allProducts.length,
      });
    }

    return allProducts;
  }

  private buildCouponPageUrl(couponInfo: CouponInfo): string {
    const params = new URLSearchParams({
      redirectAsin: couponInfo.redirectAsin,
      redirectMerchantId: couponInfo.redirectMerchantId,
    });
    return `${AMAZON_BASE_URL}/promotion/psp/${couponInfo.promotionId}?${params.toString()}`;
  }

  private buildProductListPayload(
    couponInfo: CouponInfo,
    csrfToken: string,
    sortId: string,
    isFirstPageLoad: boolean,
  ): Record<string, unknown> {
    return {
      promotionId: couponInfo.promotionId,
      redirectAsin: couponInfo.redirectAsin,
      redirectMerchantId: couponInfo.redirectMerchantId,
      promotionMerchantId: couponInfo.promotionMerchantId,
      'anti-csrftoken-a2z': csrfToken,
      sortId,
      avgCustomerReview: '0',
      priceTierMin: '',
      priceTierMax: '',
      bestSeller: '0',
      applicabilityIndex: '',
      productCategory: '',
      searchKeyword: '',
      'productCategories': '[]',
      subProductCategory: '',
      'selectedBrands': '[]',
      isSNSOnly: 'false',
      isSUSOnly: 'false',
      isCarouselPilot: 'false',
      isPrimeShippingEligible: 'true',
      isPreview: 'false',
      isFirstPageLoadRequest: isFirstPageLoad ? 'true' : 'false',
      'recordedGroupingIds': '[]',
    };
  }

  private mapProduct(item: ProductInfoItem): Product {
    return {
      asin: item.asin,
      title: item.title,
      price: item.priceInfo?.priceToPay?.displayString ?? '',
      originalPrice: item.priceInfo?.basicPrice?.displayString ?? '',
      prime: item.prime ?? false,
      rating: item.customerReviewsSummary?.rating ?? 0,
      reviewCount: item.customerReviewsSummary?.count ?? 0,
      badge: item.badgeType ?? '',
      url: `${AMAZON_BASE_URL}${item.detailPageLink}`,
    };
  }

  private async assertNoCaptcha(response: HttpResponse): Promise<void> {
    if (response.status === 200) {
      for (const marker of CAPTCHA_MARKERS) {
        if (response.data.includes(marker)) {
          const error = new ScraperError(
            'blocked',
            { reason: 'CAPTCHA detected' },
            { retryable: true, suggestedCooldownMs: 120_000 },
          );
          await this.notifyBlocked(error);
          throw error;
        }
      }
    }
  }

  private async notifyBlocked(error: ScraperError): Promise<void> {
    if (this.onBlocked) {
      try { await this.onBlocked(error); } catch { /* ignore callback errors */ }
    }
  }

  private async randomDelay(): Promise<void> {
    const ms =
      Math.floor(Math.random() * (this.delayConfig.max - this.delayConfig.min + 1)) +
      this.delayConfig.min;
    await this.delay(ms);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
