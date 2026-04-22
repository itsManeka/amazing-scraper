import { ExtractApplicableCouponProducts } from '../../src/application/use-cases/ExtractApplicableCouponProducts';
import { HttpClient, HttpResponse } from '../../src/application/ports/HttpClient';
import { HtmlParser } from '../../src/application/ports/HtmlParser';
import { Logger } from '../../src/application/ports/Logger';
import { RetryPolicy, RetryDecision } from '../../src/application/ports/RetryPolicy';
import { UserAgentProvider } from '../../src/application/ports/UserAgentProvider';
import { IndividualCouponInfo, CouponMetadata } from '../../src/domain/entities';
import { FetchIndividualCouponTerms } from '../../src/application/use-cases/FetchIndividualCouponTerms';
import { ScraperError } from '../../src/domain/errors';

const TEST_UA = 'Mozilla/5.0 TestBrowser/1.0';

function makeCoupon03Info(overrides?: Partial<IndividualCouponInfo>): IndividualCouponInfo {
  return {
    promotionId: 'AF12ZU9VE9JOE',
    couponCode: null,
    discountText: null,
    description: 'Aplicar cupom de 10%',
    termsUrl: '/promotion/details/popup/AF12ZU9VE9JOE',
    isIndividual: true,
    isApplicable: true,
    participatingProductsUrl: null,
    discountPercent: 10,
    ...overrides,
  };
}

function makeCoupon04Info(overrides?: Partial<IndividualCouponInfo>): IndividualCouponInfo {
  return {
    promotionId: 'A227SUYAFEZIRF',
    couponCode: null,
    discountText: null,
    description: 'Aplicar cupom de 15%',
    termsUrl: '/promotion/details/popup/A227SUYAFEZIRF',
    isIndividual: true,
    isApplicable: true,
    participatingProductsUrl: '/promotion/applicable/A227SUYAFEZIRF',
    discountPercent: 15,
    ...overrides,
  };
}

function makeProductItem(asin: string, sortIdValue: number) {
  return {
    asin,
    title: `Product ${asin}`,
    priceInfo: {
      priceToPay: { displayString: 'R$ 10,00' },
      basicPrice: { displayString: 'R$ 20,00' },
    },
    prime: true,
    customerReviewsSummary: { rating: 4.5, count: 100 },
    badgeType: 'BEST_SELLER',
    detailPageLink: `/dp/${asin}`,
    sortId: [sortIdValue],
  };
}

function ok(data: string): HttpResponse {
  return { status: 200, data };
}

function productListResponse(
  items: ReturnType<typeof makeProductItem>[],
  reachBottom = false,
) {
  return ok(
    JSON.stringify({
      viewModels: { PRODUCT_INFO_LIST: items },
      reachBottom,
    }),
  );
}

function emptyProductList() {
  return ok(
    JSON.stringify({
      viewModels: { PRODUCT_INFO_LIST: [] },
      reachBottom: true,
    }),
  );
}

function createMocks() {
  const httpClient: jest.Mocked<HttpClient> = {
    get: jest.fn(),
    post: jest.fn(),
  };

  const defaultMetadata: CouponMetadata = {
    title: 'Cupom de teste',
    description: 'Descricao do cupom',
    expiresAt: null,
  };

  const htmlParser: jest.Mocked<HtmlParser> = {
    extractCouponInfo: jest.fn(),
    extractIndividualCouponInfo: jest.fn(),
    extractIndividualCouponTerms: jest.fn(),
    extractIndividualCouponExpiration: jest.fn().mockReturnValue(null),
    extractCsrfToken: jest.fn(),
    extractCouponMetadata: jest.fn().mockReturnValue(defaultMetadata),
    extractProductInfo: jest.fn(),
    extractSearchResultAsins: jest.fn(),
    hasNextSearchPage: jest.fn(),
  };

  const logger: jest.Mocked<Logger> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const userAgentProvider: jest.Mocked<UserAgentProvider> = {
    get: jest.fn().mockReturnValue(TEST_UA),
  };

  const retryPolicy: jest.Mocked<RetryPolicy> = {
    evaluate: jest.fn().mockReturnValue({ shouldRetry: false, delayMs: 0 } as RetryDecision),
  };

  const fetchIndividualCouponTerms = {
    execute: jest.fn(),
  } as unknown as jest.Mocked<FetchIndividualCouponTerms>;

  return { httpClient, htmlParser, logger, userAgentProvider, retryPolicy, fetchIndividualCouponTerms };
}

function createUseCase(
  mocks: ReturnType<typeof createMocks>,
  opts?: {
    paginationLimits?: { maxProducts?: number; maxPages?: number };
    onBlocked?: (error: ScraperError) => Promise<void>;
  },
) {
  const useCase = new ExtractApplicableCouponProducts(
    mocks.httpClient,
    mocks.htmlParser,
    mocks.logger,
    mocks.userAgentProvider,
    mocks.retryPolicy,
    mocks.fetchIndividualCouponTerms,
    opts?.onBlocked,
    { min: 0, max: 0 },
    opts?.paginationLimits,
  );
  jest.spyOn(useCase as never, 'delay' as never).mockResolvedValue(undefined as never);
  return useCase;
}

describe('ExtractApplicableCouponProducts', () => {
  describe('T6-1: Coupon-03 happy path', () => {
    it('returns sourceAsin without making request to participatingProductsUrl', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);
      const couponInfo = makeCoupon03Info();
      const sourceAsin = 'B0AUXOM1';

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 30 de abril de 2026 as 23:59');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('30/04/2026');

      const result = await useCase.execute(couponInfo, sourceAsin);

      expect(result).toEqual({
        promotionId: 'AF12ZU9VE9JOE',
        asins: ['B0AUXOM1'],
        expiresAt: '30/04/2026',
      });

      // Assert that httpClient.get was NOT called for participatingProductsUrl
      expect(mocks.httpClient.get).not.toHaveBeenCalled();
      // Assert that fetchIndividualCouponTerms was called exactly once
      expect(mocks.fetchIndividualCouponTerms.execute).toHaveBeenCalledTimes(1);
      expect(mocks.fetchIndividualCouponTerms.execute).toHaveBeenCalledWith(couponInfo.termsUrl);
    });
  });

  describe('T6-2: Coupon-04 happy path', () => {
    it('extracts ASINs from pagination and uses expiration from terms', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);
      const couponInfo = makeCoupon04Info();
      const sourceAsin = 'B0AXXX';

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>coupon page with CSRF</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('CSRF_TOKEN_04');

      mocks.httpClient.post.mockResolvedValueOnce(
        productListResponse([
          makeProductItem('B001', 100.5),
          makeProductItem('B002', 200.3),
          makeProductItem('B003', 300.1),
        ], true),
      );

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      const result = await useCase.execute(couponInfo, sourceAsin);

      expect(result).toEqual({
        promotionId: 'A227SUYAFEZIRF',
        asins: ['B001', 'B002', 'B003'],
        expiresAt: '25/05/2026',
      });

      // Assert that GET was called for participatingProductsUrl
      expect(mocks.httpClient.get).toHaveBeenCalledTimes(1);
      // Assert that POST was called for pagination
      expect(mocks.httpClient.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('T6-3: Coupon-04 multi-page pagination', () => {
    it('accumulates ASINs across multiple pages and deduplicates', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);
      const couponInfo = makeCoupon04Info();
      const sourceAsin = 'B0AXXX';

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>coupon page</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('CSRF_TOKEN_04');

      // First page: 2 products, reachBottom=false
      // Second page: 3 products (1 duplicate), reachBottom=true
      mocks.httpClient.post
        .mockResolvedValueOnce(productListResponse([
          makeProductItem('B001', 100.5),
          makeProductItem('B002', 200.3),
        ], false))
        .mockResolvedValueOnce(productListResponse([
          makeProductItem('B002', 200.3), // duplicate
          makeProductItem('B003', 300.1),
          makeProductItem('B004', 400.1),
        ], true));

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      const result = await useCase.execute(couponInfo, sourceAsin);

      expect(result.asins).toHaveLength(4);
      expect(result.asins).toEqual(['B001', 'B002', 'B003', 'B004']);
      expect(mocks.httpClient.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('T6-4: Falha termsUrl (degrade)', () => {
    it('returns null expiresAt when fetchIndividualCouponTerms returns null', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);
      const couponInfo = makeCoupon03Info();
      const sourceAsin = 'B0AUXOM1';

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue(null);

      const result = await useCase.execute(couponInfo, sourceAsin);

      expect(result).toEqual({
        promotionId: 'AF12ZU9VE9JOE',
        asins: ['B0AUXOM1'],
        expiresAt: null,
      });

      expect(mocks.logger.warn).toHaveBeenCalled();
      expect(mocks.httpClient.get).not.toHaveBeenCalled();
    });
  });

  describe('T6-5: Coupon-04 sem produtos', () => {
    it('returns fallback sourceAsin when pagination yields no products', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);
      const couponInfo = makeCoupon04Info();
      const sourceAsin = 'B0AXXX';

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>coupon page</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('CSRF_TOKEN_04');
      mocks.httpClient.post.mockResolvedValueOnce(emptyProductList());

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      const result = await useCase.execute(couponInfo, sourceAsin);

      expect(result).toEqual({
        promotionId: 'A227SUYAFEZIRF',
        asins: ['B0AXXX'], // fallback to sourceAsin
        expiresAt: '25/05/2026',
      });

      // Should log about pagination (empty page)
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Pagination complete'),
        expect.any(Object),
      );
    });
  });

  describe('T6-6: Coupon-04 CSRF ausente', () => {
    it('throws ScraperError when CSRF token is not found', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);
      const couponInfo = makeCoupon04Info();
      const sourceAsin = 'B0AXXX';

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>coupon page no csrf</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue(null);

      await expect(useCase.execute(couponInfo, sourceAsin))
        .rejects
        .toThrow(ScraperError);

      expect(mocks.httpClient.post).not.toHaveBeenCalled();
    });
  });

  describe('T6-7: SSRF guard em participatingProductsUrl', () => {
    it('returns fallback when participatingProductsUrl has invalid hostname', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);
      const couponInfo = makeCoupon04Info({
        participatingProductsUrl: 'https://evil.com/promotion/psp/X',
      });
      const sourceAsin = 'B0AXXX';

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      const result = await useCase.execute(couponInfo, sourceAsin);

      expect(result).toEqual({
        promotionId: 'A227SUYAFEZIRF',
        asins: ['B0AXXX'],
        expiresAt: '25/05/2026',
      });

      // Assert that httpClient.get was NOT called for evil.com
      expect(mocks.httpClient.get).not.toHaveBeenCalled();
      // Assert that logger.warn was called with hostname validation warning
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('unexpected host'),
        expect.objectContaining({
          participatingProductsUrl: 'https://evil.com/promotion/psp/X',
        }),
      );
    });

    it('rejects http:// URLs in participatingProductsUrl and returns fallback', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);
      const couponInfo = makeCoupon04Info({
        participatingProductsUrl: 'http://www.amazon.com.br/promotion/applicable/A227SUYAFEZIRF',
      });
      const sourceAsin = 'B0AXXX';

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      const result = await useCase.execute(couponInfo, sourceAsin);

      expect(result).toEqual({
        promotionId: 'A227SUYAFEZIRF',
        asins: ['B0AXXX'],
        expiresAt: '25/05/2026',
      });

      // Assert that httpClient.get was NOT called (https-only guard rejects http)
      expect(mocks.httpClient.get).not.toHaveBeenCalled();
      // Assert that logger.warn was called with protocol validation warning
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('unexpected host'),
        expect.objectContaining({
          participatingProductsUrl: 'http://www.amazon.com.br/promotion/applicable/A227SUYAFEZIRF',
        }),
      );
    });
  });

  describe('T6-8: Precondicao isApplicable=false', () => {
    it('throws ScraperError with code not_applicable_coupon', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);
      const couponInfo = makeCoupon03Info({ isApplicable: false });
      const sourceAsin = 'B0AUXOM1';

      await expect(useCase.execute(couponInfo, sourceAsin))
        .rejects
        .toMatchObject({ code: 'not_applicable_coupon' });

      expect(mocks.httpClient.get).not.toHaveBeenCalled();
      expect(mocks.httpClient.post).not.toHaveBeenCalled();
      expect(mocks.fetchIndividualCouponTerms.execute).not.toHaveBeenCalled();
    });
  });

  describe('T6-9: Retry apos 503 na paginacao', () => {
    it('retries pagination POST on 503 status code', async () => {
      const mocks = createMocks();
      mocks.retryPolicy.evaluate
        .mockReturnValueOnce({ shouldRetry: true, delayMs: 100 } as RetryDecision)
        .mockReturnValueOnce({ shouldRetry: false, delayMs: 0 } as RetryDecision);

      const useCase = createUseCase(mocks);
      const couponInfo = makeCoupon04Info();
      const sourceAsin = 'B0AXXX';

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>coupon page</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('CSRF_TOKEN_04');

      // First call: 503, second call (after retry): 200 with products
      mocks.httpClient.post
        .mockResolvedValueOnce({ status: 503, data: 'Service Unavailable' })
        .mockResolvedValueOnce(productListResponse([
          makeProductItem('B001', 100.5),
        ], true));

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      const result = await useCase.execute(couponInfo, sourceAsin);

      expect(result.asins).toEqual(['B001']);
      expect(mocks.httpClient.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('T6-10: CAPTCHA na paginacao', () => {
    it('detects CAPTCHA in pagination response and calls onBlocked', async () => {
      const mocks = createMocks();
      const onBlocked = jest.fn().mockResolvedValue(undefined);
      const useCase = createUseCase(mocks, { onBlocked });
      const couponInfo = makeCoupon04Info();
      const sourceAsin = 'B0AXXX';

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>coupon page</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('CSRF_TOKEN_04');

      // Pagination POST returns 200 but with CAPTCHA marker
      mocks.httpClient.post.mockResolvedValueOnce({
        status: 200,
        data: '<form action="/errors/validateCaptcha"><input name="captcha" /></form>',
      });

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      await expect(useCase.execute(couponInfo, sourceAsin))
        .rejects
        .toMatchObject({ code: 'blocked', context: { reason: 'CAPTCHA detected' } });

      expect(onBlocked).toHaveBeenCalled();
    });
  });

  describe('T6-11: JSON invalido na paginacao', () => {
    it('handles invalid JSON in pagination response', async () => {
      const mocks = createMocks();
      const onBlocked = jest.fn().mockResolvedValue(undefined);
      const useCase = createUseCase(mocks, { onBlocked });
      const couponInfo = makeCoupon04Info();
      const sourceAsin = 'B0AXXX';

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>coupon page</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('CSRF_TOKEN_04');

      // Pagination POST returns 200 but with malformed JSON
      mocks.httpClient.post.mockResolvedValueOnce({
        status: 200,
        data: '{invalid json}',
      });

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      await expect(useCase.execute(couponInfo, sourceAsin))
        .rejects
        .toMatchObject({ code: 'blocked', context: { reason: 'Invalid JSON response' } });

      expect(onBlocked).toHaveBeenCalled();
    });
  });

  describe('T6-12: Cycling detection (newInPage === 0)', () => {
    it('stops pagination when all products in page are duplicates', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);
      const couponInfo = makeCoupon04Info();
      const sourceAsin = 'B0AXXX';

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>coupon page</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('CSRF_TOKEN_04');

      // First page: 2 new products
      // Second page: all duplicates (cycling detected)
      mocks.httpClient.post
        .mockResolvedValueOnce(productListResponse([
          makeProductItem('B001', 100.5),
          makeProductItem('B002', 200.3),
        ], false))
        .mockResolvedValueOnce(productListResponse([
          makeProductItem('B001', 100.5),
          makeProductItem('B002', 200.3),
        ], false));

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      const result = await useCase.execute(couponInfo, sourceAsin);

      expect(result.asins).toEqual(['B001', 'B002']);
      expect(mocks.httpClient.post).toHaveBeenCalledTimes(2);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('cycling detected'),
        expect.any(Object),
      );
    });
  });

  describe('T6-13: maxPages limit reached', () => {
    it('stops pagination when max pages limit is reached', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks, {
        paginationLimits: { maxPages: 2 },
      });
      const couponInfo = makeCoupon04Info();
      const sourceAsin = 'B0AXXX';

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>coupon page</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('CSRF_TOKEN_04');

      // Two pages with reachBottom=false (would continue if not for maxPages limit)
      mocks.httpClient.post
        .mockResolvedValueOnce(productListResponse([makeProductItem('B001', 100.5)], false))
        .mockResolvedValueOnce(productListResponse([makeProductItem('B002', 200.3)], false));

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      const result = await useCase.execute(couponInfo, sourceAsin);

      expect(result.asins).toEqual(['B001', 'B002']);
      expect(mocks.httpClient.post).toHaveBeenCalledTimes(2);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Max pages reached'),
        expect.any(Object),
      );
    });
  });

  describe('T6-14: maxProducts limit reached', () => {
    it('stops pagination when max products limit is reached', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks, {
        paginationLimits: { maxProducts: 2 },
      });
      const couponInfo = makeCoupon04Info();
      const sourceAsin = 'B0AXXX';

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>coupon page</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('CSRF_TOKEN_04');

      // Multiple pages but would exceed maxProducts limit
      mocks.httpClient.post
        .mockResolvedValueOnce(productListResponse([
          makeProductItem('B001', 100.5),
          makeProductItem('B002', 200.3),
        ], false))
        .mockResolvedValueOnce(productListResponse([
          makeProductItem('B003', 300.1),
          makeProductItem('B004', 400.1),
        ], false));

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      const result = await useCase.execute(couponInfo, sourceAsin);

      expect(result.asins).toEqual(['B001', 'B002']);
      expect(mocks.httpClient.post).toHaveBeenCalledTimes(1);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Max products reached'),
        expect.any(Object),
      );
    });
  });

  describe('T6-15: URL relativa em participatingProductsUrl', () => {
    it('resolves relative URL against Amazon base URL', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);
      const couponInfo = makeCoupon04Info({
        participatingProductsUrl: '/promotion/applicable/A227SUYAFEZIRF',
      });
      const sourceAsin = 'B0AXXX';

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>coupon page</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('CSRF_TOKEN_04');

      mocks.httpClient.post.mockResolvedValueOnce(productListResponse([
        makeProductItem('B001', 100.5),
      ], true));

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      const result = await useCase.execute(couponInfo, sourceAsin);

      expect(result.asins).toEqual(['B001']);
      // Verify GET was called with the resolved URL
      expect(mocks.httpClient.get).toHaveBeenCalledWith(
        expect.stringContaining('amazon.com.br'),
        expect.any(Object),
      );
    });
  });

  describe('T6-16: reachBottom flag (explicit end condition)', () => {
    it('stops pagination when reachBottom flag is true', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);
      const couponInfo = makeCoupon04Info();
      const sourceAsin = 'B0AXXX';

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>coupon page</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('CSRF_TOKEN_04');

      mocks.httpClient.post.mockResolvedValueOnce(productListResponse([
        makeProductItem('B001', 100.5),
      ], true)); // reachBottom=true

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      const result = await useCase.execute(couponInfo, sourceAsin);

      expect(result.asins).toEqual(['B001']);
      expect(mocks.httpClient.post).toHaveBeenCalledTimes(1);
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('reachBottom flag'),
        expect.any(Object),
      );
    });
  });

  describe('T6-17: sortId loop detection', () => {
    it('stops pagination when sortId repeats', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);
      const couponInfo = makeCoupon04Info();
      const sourceAsin = 'B0AXXX';

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>coupon page</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('CSRF_TOKEN_04');

      // Both pages return the same sortId[0]=100, causing loop detection
      mocks.httpClient.post
        .mockResolvedValueOnce(productListResponse([
          makeProductItem('B001', 100),
        ], false))
        .mockResolvedValueOnce(productListResponse([
          makeProductItem('B002', 100), // Same sortId
        ], false));

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      const result = await useCase.execute(couponInfo, sourceAsin);

      expect(result.asins).toEqual(['B001', 'B002']);
      expect(mocks.httpClient.post).toHaveBeenCalledTimes(2);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('sortId loop'),
        expect.any(Object),
      );
    });
  });

  describe('T6-18: Network error on GET (participating products page)', () => {
    it('returns fallback when network error fetching coupon page', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);
      const couponInfo = makeCoupon04Info();
      const sourceAsin = 'B0AXXX';

      mocks.httpClient.get.mockRejectedValueOnce(new Error('Network timeout'));

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      const result = await useCase.execute(couponInfo, sourceAsin);

      expect(result).toEqual({
        promotionId: 'A227SUYAFEZIRF',
        asins: ['B0AXXX'], // fallback to sourceAsin
        expiresAt: '25/05/2026',
      });

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Network error'),
        expect.any(Object),
      );
    });
  });

  describe('T6-19: 403 Forbidden (session expired)', () => {
    it('throws ScraperError with code session_expired on 403 response', async () => {
      const mocks = createMocks();
      const onBlocked = jest.fn().mockResolvedValue(undefined);
      const useCase = createUseCase(mocks, { onBlocked });
      const couponInfo = makeCoupon04Info();
      const sourceAsin = 'B0AXXX';

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>coupon page</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('CSRF_TOKEN_04');

      mocks.httpClient.post.mockResolvedValueOnce({
        status: 403,
        data: 'Forbidden',
      });

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      await expect(useCase.execute(couponInfo, sourceAsin))
        .rejects
        .toMatchObject({ code: 'session_expired' });

      expect(onBlocked).toHaveBeenCalled();
    });
  });

  describe('T6-20: Non-200 response on participating products page', () => {
    it('returns fallback when GET returns non-200 status', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);
      const couponInfo = makeCoupon04Info();
      const sourceAsin = 'B0AXXX';

      mocks.httpClient.get.mockResolvedValueOnce({
        status: 404,
        data: 'Not Found',
      });

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      const result = await useCase.execute(couponInfo, sourceAsin);

      expect(result).toEqual({
        promotionId: 'A227SUYAFEZIRF',
        asins: ['B0AXXX'], // fallback to sourceAsin
        expiresAt: '25/05/2026',
      });

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Non-200'),
        expect.any(Object),
      );
    });
  });

  describe('T6-21: Network error on POST pagination with retry disabled', () => {
    it('throws error when pagination POST fails and retry is disabled', async () => {
      const mocks = createMocks();
      const onBlocked = jest.fn().mockResolvedValue(undefined);
      mocks.retryPolicy.evaluate.mockReturnValue({ shouldRetry: false, delayMs: 0 } as RetryDecision);

      const useCase = createUseCase(mocks, { onBlocked });
      const couponInfo = makeCoupon04Info();
      const sourceAsin = 'B0AXXX';

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>coupon page</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('CSRF_TOKEN_04');

      mocks.httpClient.post.mockRejectedValueOnce(new Error('Network error'));

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      await expect(useCase.execute(couponInfo, sourceAsin))
        .rejects
        .toMatchObject({ code: 'blocked' });

      expect(onBlocked).toHaveBeenCalled();
    });
  });

  describe('T6-22: Empty items array with reachBottom=false', () => {
    it('stops pagination when pagination returns empty items', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);
      const couponInfo = makeCoupon04Info();
      const sourceAsin = 'B0AXXX';

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>coupon page</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('CSRF_TOKEN_04');

      mocks.httpClient.post.mockResolvedValueOnce(emptyProductList());

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      const result = await useCase.execute(couponInfo, sourceAsin);

      expect(result.asins).toEqual(['B0AXXX']); // fallback
      expect(mocks.httpClient.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('T6-23: Items array with no PRODUCT_INFO_LIST key', () => {
    it('handles response where items are in direct PRODUCT_INFO_LIST (fallback structure)', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);
      const couponInfo = makeCoupon04Info();
      const sourceAsin = 'B0AXXX';

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>coupon page</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('CSRF_TOKEN_04');

      // Response with items directly in PRODUCT_INFO_LIST (not nested in viewModels)
      const items = [makeProductItem('B001', 100.5)];
      mocks.httpClient.post.mockResolvedValueOnce(
        ok(
          JSON.stringify({
            PRODUCT_INFO_LIST: items,
            reachBottom: true,
          }),
        ),
      );

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      const result = await useCase.execute(couponInfo, sourceAsin);

      expect(result.asins).toEqual(['B001']);
      expect(mocks.httpClient.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('T6-24: No sortId in last item', () => {
    it('handles pagination when last item has no sortId', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);
      const couponInfo = makeCoupon04Info();
      const sourceAsin = 'B0AXXX';

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>coupon page</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('CSRF_TOKEN_04');

      const item = {
        asin: 'B001',
        title: 'Product B001',
        priceInfo: {
          priceToPay: { displayString: 'R$ 10,00' },
          basicPrice: { displayString: 'R$ 20,00' },
        },
        prime: true,
        customerReviewsSummary: { rating: 4.5, count: 100 },
        badgeType: 'BEST_SELLER',
        detailPageLink: '/dp/B001',
        // No sortId field
      };

      mocks.httpClient.post.mockResolvedValueOnce(
        ok(
          JSON.stringify({
            viewModels: { PRODUCT_INFO_LIST: [item] },
            reachBottom: true,
          }),
        ),
      );

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      const result = await useCase.execute(couponInfo, sourceAsin);

      expect(result.asins).toEqual(['B001']);
    });
  });

  describe('T6-25: Coupon-03 without termsUrl', () => {
    it('returns null expiresAt when coupon has no termsUrl', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);
      const couponInfo = makeCoupon03Info({ termsUrl: null });
      const sourceAsin = 'B0AUXOM1';

      const result = await useCase.execute(couponInfo, sourceAsin);

      expect(result).toEqual({
        promotionId: 'AF12ZU9VE9JOE',
        asins: ['B0AUXOM1'],
        expiresAt: null,
      });

      expect(mocks.fetchIndividualCouponTerms.execute).not.toHaveBeenCalled();
    });
  });

  describe('T6-26: 503 without retry enabled', () => {
    it('throws error when 503 response and retry is disabled', async () => {
      const mocks = createMocks();
      const onBlocked = jest.fn().mockResolvedValue(undefined);
      mocks.retryPolicy.evaluate.mockReturnValue({ shouldRetry: false, delayMs: 0 } as RetryDecision);

      const useCase = createUseCase(mocks, { onBlocked });
      const couponInfo = makeCoupon04Info();
      const sourceAsin = 'B0AXXX';

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>coupon page</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('CSRF_TOKEN_04');

      mocks.httpClient.post.mockResolvedValueOnce({
        status: 503,
        data: 'Service Unavailable',
      });

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      await expect(useCase.execute(couponInfo, sourceAsin))
        .rejects
        .toMatchObject({ code: 'blocked' });

      expect(onBlocked).toHaveBeenCalled();
    });
  });

  describe('T6-27: Invalid participatingProductsUrl (malformed URL)', () => {
    it('returns fallback when participatingProductsUrl is malformed', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);
      const couponInfo = makeCoupon04Info({
        participatingProductsUrl: 'not a valid url!!!',
      });
      const sourceAsin = 'B0AXXX';

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      const result = await useCase.execute(couponInfo, sourceAsin);

      expect(result).toEqual({
        promotionId: 'A227SUYAFEZIRF',
        asins: ['B0AXXX'],
        expiresAt: '25/05/2026',
      });

      expect(mocks.httpClient.get).not.toHaveBeenCalled();
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('unexpected host'),
        expect.any(Object),
      );
    });
  });

  describe('T6-28: onBlocked callback error on CSRF failure', () => {
    it('continues even if onBlocked callback throws', async () => {
      const mocks = createMocks();
      const onBlocked = jest.fn().mockRejectedValue(new Error('Callback error'));

      const useCase = createUseCase(mocks, { onBlocked });
      const couponInfo = makeCoupon04Info();
      const sourceAsin = 'B0AXXX';

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>coupon page no csrf</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue(null);

      // Should throw ScraperError despite callback failing (callback errors are ignored)
      await expect(useCase.execute(couponInfo, sourceAsin))
        .rejects
        .toMatchObject({ code: 'csrf_not_found' });

      expect(onBlocked).toHaveBeenCalled();
    });
  });

  describe('T6-29: Network error on POST pagination with retry enabled', () => {
    it('retries pagination POST on network error when retry enabled', async () => {
      const mocks = createMocks();
      // First call: shouldRetry=true, second call (after retry): shouldRetry=false
      mocks.retryPolicy.evaluate
        .mockReturnValueOnce({ shouldRetry: true, delayMs: 50 } as RetryDecision)
        .mockReturnValueOnce({ shouldRetry: false, delayMs: 0 } as RetryDecision);

      const useCase = createUseCase(mocks);
      const couponInfo = makeCoupon04Info();
      const sourceAsin = 'B0AXXX';

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>coupon page</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('CSRF_TOKEN_04');

      // First call: network error, second call: successful
      mocks.httpClient.post
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce(productListResponse([
          makeProductItem('B001', 100.5),
        ], true));

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      const result = await useCase.execute(couponInfo, sourceAsin);

      expect(result.asins).toEqual(['B001']);
      expect(mocks.httpClient.post).toHaveBeenCalledTimes(2);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('retrying'),
        expect.any(Object),
      );
    });
  });

  describe('T6-30: Pagination with mixed response structures', () => {
    it('handles pagination across pages with varying response structures', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);
      const couponInfo = makeCoupon04Info();
      const sourceAsin = 'B0AXXX';

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>coupon page</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('CSRF_TOKEN_04');

      // First page with viewModels.PRODUCT_INFO_LIST
      // Second page with direct PRODUCT_INFO_LIST
      mocks.httpClient.post
        .mockResolvedValueOnce(
          ok(
            JSON.stringify({
              viewModels: { PRODUCT_INFO_LIST: [makeProductItem('B001', 100.5)] },
              reachBottom: false,
            }),
          ),
        )
        .mockResolvedValueOnce(
          ok(
            JSON.stringify({
              PRODUCT_INFO_LIST: [makeProductItem('B002', 200.3)],
              reachBottom: true,
            }),
          ),
        );

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      const result = await useCase.execute(couponInfo, sourceAsin);

      expect(result.asins).toEqual(['B001', 'B002']);
      expect(mocks.httpClient.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('T6-31: onBlocked called with blocked error on CAPTCHA', () => {
    it('calls onBlocked with appropriate error context on CAPTCHA', async () => {
      const mocks = createMocks();
      const onBlocked = jest.fn().mockResolvedValue(undefined);

      const useCase = createUseCase(mocks, { onBlocked });
      const couponInfo = makeCoupon04Info();
      const sourceAsin = 'B0AXXX';

      mocks.httpClient.get.mockResolvedValueOnce({
        status: 200,
        data: '<form action="/errors/validateCaptcha">CAPTCHA</form>',
      });

      mocks.fetchIndividualCouponTerms.execute.mockResolvedValue('Valido ate 25 de maio de 2026');
      mocks.htmlParser.extractIndividualCouponExpiration.mockReturnValue('25/05/2026');

      await expect(useCase.execute(couponInfo, sourceAsin))
        .rejects
        .toThrow();

      expect(onBlocked).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'blocked',
          context: expect.objectContaining({ reason: 'CAPTCHA detected' }),
        }),
      );
    });
  });
});
