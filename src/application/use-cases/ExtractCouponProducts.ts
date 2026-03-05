import { Product, CouponInfo, CouponResult } from '../../domain/entities';
import { ScraperError } from '../../domain/errors';
import { HttpClient, HttpResponse } from '../ports/HttpClient';
import { HtmlParser } from '../ports/HtmlParser';
import { Logger } from '../ports/Logger';

const AMAZON_BASE_URL = 'https://www.amazon.com.br';

const CAPTCHA_MARKERS = [
  'Type the characters you see in this image',
  '/errors/validateCaptcha',
  '<form action="/errors/validateCaptcha"',
];

const DEFAULT_HEADERS: Record<string, string> = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  'accept-language': 'pt-BR,pt;q=0.9',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

export interface DelayConfig {
  min: number;
  max: number;
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

  constructor(
    private readonly httpClient: HttpClient,
    private readonly htmlParser: HtmlParser,
    private readonly logger: Logger,
    delayConfig?: DelayConfig,
  ) {
    this.delayConfig = delayConfig ?? { min: 1000, max: 2000 };
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
    const { csrfToken, couponReferer } = await this.fetchCsrfToken(couponPageUrl, productUrl);

    const products = await this.fetchAllProducts(couponInfo, csrfToken, couponReferer, productUrl);

    this.logger.info('Extraction complete', { totalProducts: products.length });

    return {
      promotionId: couponInfo.promotionId,
      sourceAsin: couponInfo.redirectAsin,
      totalProducts: products.length,
      products,
    };
  }

  private async fetchCsrfToken(
    couponPageUrl: string,
    referer: string,
  ): Promise<{ csrfToken: string; couponReferer: string }> {
    const headers = { ...DEFAULT_HEADERS, referer };
    const response = await this.getWithDelay(couponPageUrl, headers);

    this.assertNoCaptcha(response);

    if (response.status === 403 || response.status === 503) {
      throw new ScraperError('blocked', { url: couponPageUrl, status: response.status });
    }

    const csrfToken = this.htmlParser.extractCsrfToken(response.data);
    if (!csrfToken) {
      throw new ScraperError('csrf_not_found', { url: couponPageUrl });
    }

    this.logger.info('CSRF token extracted');
    return { csrfToken, couponReferer: couponPageUrl };
  }

  private async fetchAllProducts(
    couponInfo: CouponInfo,
    csrfToken: string,
    couponReferer: string,
    productUrl: string,
  ): Promise<Product[]> {
    const allProducts: Product[] = [];
    let sortId = '[]';
    let isFirstPageLoad = true;
    let sessionRefreshed = false;

    // Keep current mutable copies for session-refresh
    let currentCsrfToken = csrfToken;
    let currentCouponReferer = couponReferer;

    let hasMorePages = true;
    while (hasMorePages) {
      const payload = this.buildProductListPayload(couponInfo, currentCsrfToken, sortId, isFirstPageLoad);
      const headers: Record<string, string> = {
        'user-agent': DEFAULT_HEADERS['user-agent'],
        'accept-language': DEFAULT_HEADERS['accept-language'],
        accept: 'application/json, text/javascript, */*; q=0.01',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
        origin: AMAZON_BASE_URL,
        referer: currentCouponReferer,
      };

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
        throw new ScraperError('blocked', { phase: 'pagination', cause: String(err) });
      }

      this.assertNoCaptcha(response);

      if (response.status === 503) {
        throw new ScraperError('blocked', { phase: 'pagination', status: 503 });
      }

      if (response.status === 403) {
        if (sessionRefreshed) {
          throw new ScraperError('session_expired', { phase: 'pagination', status: 403 });
        }

        this.logger.warn('403 during pagination, refreshing session');
        sessionRefreshed = true;

        const couponPageUrl = this.buildCouponPageUrl(couponInfo);
        const refreshed = await this.fetchCsrfToken(couponPageUrl, productUrl);
        currentCsrfToken = refreshed.csrfToken;
        currentCouponReferer = refreshed.couponReferer;

        continue;
      }

      let parsed: ProductInfoListResponse;
      try {
        parsed = JSON.parse(response.data) as ProductInfoListResponse;
      } catch {
        throw new ScraperError('blocked', {
          phase: 'pagination',
          reason: 'Invalid JSON response',
        });
      }

      const items = parsed.viewModels?.PRODUCT_INFO_LIST ?? parsed.PRODUCT_INFO_LIST;
      if (!items || items.length === 0) {
        this.logger.info('Pagination complete — empty page received');
        hasMorePages = false;
        continue;
      }

      for (const item of items) {
        allProducts.push(this.mapProduct(item));
      }

      isFirstPageLoad = false;

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

  private assertNoCaptcha(response: HttpResponse): void {
    if (response.status === 200) {
      for (const marker of CAPTCHA_MARKERS) {
        if (response.data.includes(marker)) {
          throw new ScraperError('blocked', { reason: 'CAPTCHA detected' });
        }
      }
    }
  }

  private async getWithDelay(url: string, headers: Record<string, string>): Promise<HttpResponse> {
    await this.randomDelay();
    return this.httpClient.get(url, headers);
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
