import { IndividualCouponInfo } from '../../domain/entities';
import { ScraperError } from '../../domain/errors';
import { AMAZON_BASE_URL, CAPTCHA_MARKERS } from '../../infrastructure/http/amazonConstants';
import { buildGetHeaders, buildPostHeaders } from '../../infrastructure/http/buildHeaders';
import { HttpClient, HttpResponse } from '../ports/HttpClient';
import { HtmlParser } from '../ports/HtmlParser';
import { Logger } from '../ports/Logger';
import { RetryPolicy } from '../ports/RetryPolicy';
import { UserAgentProvider } from '../ports/UserAgentProvider';
import { FetchIndividualCouponTerms } from './FetchIndividualCouponTerms';

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

export interface ApplicableCouponResult {
  promotionId: string;
  asins: string[];
  expiresAt: string | null;
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

const AMAZON_HOSTNAME = 'www.amazon.com.br';

/**
 * Extracts products participating in an applicable Amazon coupon.
 * Handles two flows:
 * - Coupon-03: no participating products page (returns sourceAsin only)
 * - Coupon-04: participating products page with CSRF token and pagination
 */
export class ExtractApplicableCouponProducts {
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
    private readonly fetchIndividualCouponTerms: FetchIndividualCouponTerms,
    private readonly onBlocked?: (error: ScraperError) => Promise<void>,
    delayConfig?: DelayConfig,
    paginationLimits?: PaginationLimits,
  ) {
    this.delayConfig = delayConfig ?? { min: 1000, max: 2000 };
    this.maxProducts = paginationLimits?.maxProducts ?? 1_000;
    this.maxPages = paginationLimits?.maxPages ?? 500;
    this.userAgent = userAgentProvider.get();
  }

  async execute(
    couponInfo: IndividualCouponInfo,
    sourceAsin: string,
  ): Promise<ApplicableCouponResult> {
    this.logger.info('Starting applicable coupon extraction', {
      promotionId: couponInfo.promotionId,
      sourceAsin,
      participatesInList: !!couponInfo.participatingProductsUrl,
    });

    // Validate precondition: coupon must be marked as applicable
    if (couponInfo.isApplicable !== true) {
      const error = new ScraperError('not_applicable_coupon', {
        promotionId: couponInfo.promotionId,
        isApplicable: couponInfo.isApplicable,
      });
      throw error;
    }

    // Fetch expiration from terms (works for both coupon-03 and coupon-04)
    let expiresAt: string | null = null;
    if (couponInfo.termsUrl) {
      const termsText = await this.fetchIndividualCouponTerms.execute(couponInfo.termsUrl);
      if (termsText) {
        expiresAt = this.htmlParser.extractIndividualCouponExpiration(termsText);
      } else {
        this.logger.warn('Failed to fetch terms, expiration will be null', {
          promotionId: couponInfo.promotionId,
          termsUrl: couponInfo.termsUrl,
        });
      }
    }

    // Coupon-03 flow: no participating products page
    if (!couponInfo.participatingProductsUrl) {
      this.logger.info('Coupon-03: no participating products list', {
        promotionId: couponInfo.promotionId,
      });
      return {
        promotionId: couponInfo.promotionId,
        asins: [sourceAsin],
        expiresAt,
      };
    }

    // Coupon-04 flow: fetch participating products with pagination
    return this.extractFromParticipatingProductsPage(
      couponInfo,
      sourceAsin,
      expiresAt,
    );
  }

  private async extractFromParticipatingProductsPage(
    couponInfo: IndividualCouponInfo,
    sourceAsin: string,
    expiresAt: string | null,
  ): Promise<ApplicableCouponResult> {
    // SSRF guard: validate hostname
    const resolvedUrl = this.resolveAndValidateUrl(couponInfo.participatingProductsUrl!);
    if (!resolvedUrl) {
      this.logger.warn('Rejected participating products URL — unexpected host', {
        promotionId: couponInfo.promotionId,
        participatingProductsUrl: couponInfo.participatingProductsUrl,
      });
      return {
        promotionId: couponInfo.promotionId,
        asins: [sourceAsin],
        expiresAt,
      };
    }

    // Fetch coupon page to extract CSRF
    const productUrl = `${AMAZON_BASE_URL}/dp/${sourceAsin}`;
    const headers = buildGetHeaders(this.userAgent, productUrl);

    await this.randomDelay();
    let response: HttpResponse;
    try {
      response = await this.httpClient.get(resolvedUrl, headers);
    } catch (err) {
      this.logger.warn('Network error fetching participating products page', {
        url: resolvedUrl,
        promotionId: couponInfo.promotionId,
        error: String(err),
      });
      return {
        promotionId: couponInfo.promotionId,
        asins: [sourceAsin],
        expiresAt,
      };
    }

    await this.assertNoCaptcha(response);

    if (response.status !== 200) {
      this.logger.warn('Non-200 response from participating products page', {
        status: response.status,
        promotionId: couponInfo.promotionId,
      });
      return {
        promotionId: couponInfo.promotionId,
        asins: [sourceAsin],
        expiresAt,
      };
    }

    const csrfToken = this.htmlParser.extractCsrfToken(response.data);
    if (!csrfToken) {
      const error = new ScraperError('csrf_not_found', {
        url: resolvedUrl,
        promotionId: couponInfo.promotionId,
      });
      await this.notifyBlocked(error);
      throw error;
    }

    // Paginate through products
    const asins = await this.fetchAllProducts(couponInfo, sourceAsin, csrfToken, resolvedUrl);

    // Fallback to sourceAsin if no products found
    const resultAsins = asins.length > 0 ? asins : [sourceAsin];

    this.logger.info('Applicable coupon extraction complete', {
      promotionId: couponInfo.promotionId,
      totalAsins: resultAsins.length,
    });

    return {
      promotionId: couponInfo.promotionId,
      asins: resultAsins,
      expiresAt,
    };
  }

  private async fetchAllProducts(
    couponInfo: IndividualCouponInfo,
    sourceAsin: string,
    csrfToken: string,
    couponPageUrl: string,
  ): Promise<string[]> {
    const allAsins: string[] = [];
    const seenAsins = new Set<string>();
    let sortId = '[]';
    let isFirstPageLoad = true;
    let pageCount = 0;

    let hasMorePages = true;
    while (hasMorePages) {
      if (pageCount >= this.maxPages) {
        this.logger.warn('Max pages reached, stopping pagination', {
          maxPages: this.maxPages,
          totalAsins: allAsins.length,
        });
        break;
      }

      const payload = this.buildProductListPayload(couponInfo, sourceAsin, csrfToken, sortId, isFirstPageLoad);
      const headers = buildPostHeaders(this.userAgent, couponPageUrl);

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
          { phase: 'pagination', promotionId: couponInfo.promotionId, cause: String(err) },
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
          { phase: 'pagination', status: 503, promotionId: couponInfo.promotionId },
          { retryable: true, suggestedCooldownMs: 30_000 },
        );
        await this.notifyBlocked(error);
        throw error;
      }

      if (response.status === 403) {
        const error = new ScraperError(
          'session_expired',
          { phase: 'pagination', status: 403, promotionId: couponInfo.promotionId },
          { retryable: false },
        );
        await this.notifyBlocked(error);
        throw error;
      }

      let parsed: ProductInfoListResponse;
      try {
        parsed = JSON.parse(response.data) as ProductInfoListResponse;
      } catch {
        const error = new ScraperError('blocked', {
          phase: 'pagination',
          promotionId: couponInfo.promotionId,
          reason: 'Invalid JSON response',
        });
        await this.notifyBlocked(error);
        throw error;
      }

      const items = parsed.viewModels?.PRODUCT_INFO_LIST ?? parsed.PRODUCT_INFO_LIST;
      if (!items || items.length === 0) {
        this.logger.info('Pagination complete — empty page received', {
          promotionId: couponInfo.promotionId,
        });
        hasMorePages = false;
        continue;
      }

      let newInPage = 0;
      for (const item of items) {
        if (!seenAsins.has(item.asin)) {
          seenAsins.add(item.asin);
          allAsins.push(item.asin);
          newInPage++;
        }
      }

      if (newInPage === 0) {
        this.logger.warn('All products in page already seen — API cycling detected, stopping', {
          totalAsins: allAsins.length,
          pageCount,
          promotionId: couponInfo.promotionId,
        });
        break;
      }

      isFirstPageLoad = false;

      if (allAsins.length >= this.maxProducts) {
        this.logger.warn('Max products reached, stopping pagination', {
          maxProducts: this.maxProducts,
          totalAsins: allAsins.length,
        });
        break;
      }

      const lastItem = items[items.length - 1];
      const newSortId = lastItem.sortId?.[0] != null ? `[${lastItem.sortId[0]}]` : '[]';

      if (parsed.reachBottom === true) {
        this.logger.info('Pagination complete — reachBottom flag set', {
          totalAsins: allAsins.length,
          promotionId: couponInfo.promotionId,
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
        totalAsins: allAsins.length,
      });
    }

    return allAsins;
  }

  private buildProductListPayload(
    couponInfo: IndividualCouponInfo,
    sourceAsin: string,
    csrfToken: string,
    sortId: string,
    isFirstPageLoad: boolean,
  ): Record<string, unknown> {
    return {
      promotionId: couponInfo.promotionId,
      redirectAsin: sourceAsin,
      redirectMerchantId: '',
      promotionMerchantId: '',
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

  /**
   * Builds the absolute URL from a `participatingProductsUrl` and validates
   * that the resolved hostname is `www.amazon.com.br`. Returns `null` when
   * the URL is invalid or resolves to a different host (SSRF guard).
   */
  private resolveAndValidateUrl(participatingProductsUrl: string): string | null {
    if (!participatingProductsUrl || typeof participatingProductsUrl !== 'string') return null;

    let parsed: URL;
    try {
      parsed = participatingProductsUrl.startsWith('/')
        ? new URL(participatingProductsUrl, AMAZON_BASE_URL)
        : new URL(participatingProductsUrl);
    } catch {
      return null;
    }

    if (parsed.hostname !== AMAZON_HOSTNAME) return null;
    // Restrict to https-only; http is downgraded by Amazon anyway and adds unnecessary risk
    if (parsed.protocol !== 'https:') return null;

    return parsed.toString();
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
