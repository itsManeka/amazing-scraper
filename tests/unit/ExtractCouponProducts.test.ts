import { ExtractCouponProducts } from '../../src/application/use-cases/ExtractCouponProducts';
import { HttpClient, HttpResponse } from '../../src/application/ports/HttpClient';
import { HtmlParser } from '../../src/application/ports/HtmlParser';
import { Logger } from '../../src/application/ports/Logger';
import { RetryPolicy, RetryDecision } from '../../src/application/ports/RetryPolicy';
import { UserAgentProvider } from '../../src/application/ports/UserAgentProvider';
import { CouponInfo, CouponMetadata } from '../../src/domain/entities';
import { ScraperError } from '../../src/domain/errors';

const TEST_UA = 'Mozilla/5.0 TestBrowser/1.0';

const COUPON_INFO: CouponInfo = {
  promotionId: 'PROMO123',
  redirectAsin: 'B0TEST',
  redirectMerchantId: 'MERCH1',
  promotionMerchantId: 'MERCH1',
  couponCode: null,
};

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
    expiresAt: 'domingo 15 de marco de 2026',
  };

  const htmlParser: jest.Mocked<HtmlParser> = {
    extractCouponInfo: jest.fn(),
    extractIndividualCouponInfo: jest.fn(),
    extractIndividualCouponTerms: jest.fn(),
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

  return { httpClient, htmlParser, logger, userAgentProvider, retryPolicy };
}

function createUseCase(
  mocks: ReturnType<typeof createMocks>,
  opts?: {
    paginationLimits?: { maxProducts?: number; maxPages?: number };
    onBlocked?: (error: ScraperError) => Promise<void>;
  },
) {
  const useCase = new ExtractCouponProducts(
    mocks.httpClient,
    mocks.htmlParser,
    mocks.logger,
    mocks.userAgentProvider,
    mocks.retryPolicy,
    opts?.onBlocked,
    { min: 0, max: 0 },
    opts?.paginationLimits,
  );
  jest.spyOn(useCase as never, 'delay' as never).mockResolvedValue(undefined as never);
  return useCase;
}

describe('ExtractCouponProducts', () => {
  describe('success with multi-page pagination', () => {
    it('collects products from multiple pages', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon page</html>'));

      mocks.htmlParser.extractCsrfToken.mockReturnValue('CSRF_TOKEN');

      mocks.httpClient.post
        .mockResolvedValueOnce(productListResponse([
          makeProductItem('B001', 100.5),
          makeProductItem('B002', 200.3),
        ]))
        .mockResolvedValueOnce(productListResponse([
          makeProductItem('B003', 300.1),
        ]))
        .mockResolvedValueOnce(emptyProductList());

      const result = await useCase.execute(COUPON_INFO);

      expect(result.totalProducts).toBe(3);
      expect(result.products.map(p => p.asin)).toEqual(['B001', 'B002', 'B003']);
      expect(result.promotionId).toBe('PROMO123');
      expect(result).not.toHaveProperty('sourceAsin');
    });
  });

  describe('ScraperError(csrf_not_found)', () => {
    it('throws when CSRF token is not found on coupon page', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon page without token</html>'));

      mocks.htmlParser.extractCsrfToken.mockReturnValue(null);

      try {
        await useCase.execute(COUPON_INFO);
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ScraperError);
        expect((err as ScraperError).code).toBe('csrf_not_found');
      }
    });

    it('calls onBlocked on csrf_not_found', async () => {
      const mocks = createMocks();
      const onBlocked = jest.fn().mockResolvedValue(undefined);
      const useCase = createUseCase(mocks, { onBlocked });

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon page without token</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue(null);

      await expect(useCase.execute(COUPON_INFO)).rejects.toMatchObject({ code: 'csrf_not_found' });
      expect(onBlocked).toHaveBeenCalledTimes(1);
      expect(onBlocked).toHaveBeenCalledWith(expect.objectContaining({ code: 'csrf_not_found' }));
    });
  });

  describe('CAPTCHA detection', () => {
    it('throws blocked with retryable: true and suggestedCooldownMs: 120000 on CAPTCHA in pagination', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('TOKEN');
      mocks.httpClient.post.mockResolvedValueOnce(
        ok('Type the characters you see in this image'),
      );

      try {
        await useCase.execute(COUPON_INFO);
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ScraperError);
        const se = err as ScraperError;
        expect(se.code).toBe('blocked');
        expect(se.retryable).toBe(true);
        expect(se.suggestedCooldownMs).toBe(120_000);
      }
    });

    it('throws blocked when coupon page contains CAPTCHA', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get.mockResolvedValueOnce(
        ok('<html><form action="/errors/validateCaptcha"></form></html>'),
      );

      try {
        await useCase.execute(COUPON_INFO);
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ScraperError);
        expect((err as ScraperError).code).toBe('blocked');
      }
    });

    it('calls onBlocked on CAPTCHA detection', async () => {
      const mocks = createMocks();
      const onBlocked = jest.fn().mockResolvedValue(undefined);
      const useCase = createUseCase(mocks, { onBlocked });

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('TOKEN');
      mocks.httpClient.post.mockResolvedValueOnce(
        ok('Type the characters you see in this image'),
      );

      await expect(useCase.execute(COUPON_INFO)).rejects.toMatchObject({ code: 'blocked' });
      expect(onBlocked).toHaveBeenCalledTimes(1);
      expect(onBlocked).toHaveBeenCalledWith(
        expect.objectContaining({ suggestedCooldownMs: 120_000 }),
      );
    });
  });

  describe('403 during pagination — session refresh', () => {
    it('calls retryPolicy.evaluate with errorType session on 403, then refreshes CSRF', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon page 1</html>'))
        .mockResolvedValueOnce(ok('<html>coupon page 2</html>'));

      mocks.htmlParser.extractCsrfToken.mockReturnValue('REFRESHED_TOKEN');

      mocks.httpClient.post
        .mockResolvedValueOnce(productListResponse([makeProductItem('B001', 100)]))
        .mockResolvedValueOnce({ status: 403, data: '' })
        .mockResolvedValueOnce(productListResponse([makeProductItem('B002', 200)]))
        .mockResolvedValueOnce(emptyProductList());

      const result = await useCase.execute(COUPON_INFO);

      expect(result.totalProducts).toBe(2);
      expect(result.products.map(p => p.asin)).toEqual(['B001', 'B002']);
      expect(mocks.retryPolicy.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 403, errorType: 'session' }),
      );
    });

    it('throws session_expired when 403 persists after refresh', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon</html>'))
        .mockResolvedValueOnce(ok('<html>coupon refresh</html>'));

      mocks.htmlParser.extractCsrfToken.mockReturnValue('TOKEN');

      mocks.httpClient.post
        .mockResolvedValueOnce({ status: 403, data: '' })
        .mockResolvedValueOnce({ status: 403, data: '' });

      try {
        await useCase.execute(COUPON_INFO);
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ScraperError);
        const se = err as ScraperError;
        expect(se.code).toBe('session_expired');
        expect(se.retryable).toBe(false);
      }
    });
  });

  describe('503 during pagination — retry via RetryPolicy', () => {
    it('retries on 503 when retryPolicy says to retry', async () => {
      const mocks = createMocks();
      mocks.retryPolicy.evaluate.mockReturnValueOnce({ shouldRetry: true, delayMs: 2000 });

      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('TOKEN');

      mocks.httpClient.post
        .mockResolvedValueOnce({ status: 503, data: '' })
        .mockResolvedValueOnce(productListResponse([makeProductItem('B001', 100)]))
        .mockResolvedValueOnce(emptyProductList());

      const result = await useCase.execute(COUPON_INFO);

      expect(result.totalProducts).toBe(1);
      expect(mocks.retryPolicy.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 503, errorType: 'http' }),
      );
    });

    it('throws blocked with retryable: true when retries exhausted on 503', async () => {
      const mocks = createMocks();
      mocks.retryPolicy.evaluate.mockReturnValue({ shouldRetry: false, delayMs: 0 });

      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('TOKEN');
      mocks.httpClient.post.mockResolvedValueOnce({ status: 503, data: '' });

      try {
        await useCase.execute(COUPON_INFO);
        fail('Should have thrown');
      } catch (err) {
        const se = err as ScraperError;
        expect(se.code).toBe('blocked');
        expect(se.retryable).toBe(true);
        expect(se.suggestedCooldownMs).toBe(30_000);
      }
    });
  });

  describe('network error during pagination — retry via RetryPolicy', () => {
    it('retries on network error when retryPolicy says to retry', async () => {
      const mocks = createMocks();
      mocks.retryPolicy.evaluate.mockReturnValueOnce({ shouldRetry: true, delayMs: 2000 });

      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('TOKEN');

      mocks.httpClient.post
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce(productListResponse([makeProductItem('B001', 100)]))
        .mockResolvedValueOnce(emptyProductList());

      const result = await useCase.execute(COUPON_INFO);

      expect(result.totalProducts).toBe(1);
      expect(mocks.retryPolicy.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 0, errorType: 'network' }),
      );
    });

    it('throws blocked when network retries exhausted', async () => {
      const mocks = createMocks();
      mocks.retryPolicy.evaluate.mockReturnValue({ shouldRetry: false, delayMs: 0 });

      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('TOKEN');
      mocks.httpClient.post.mockRejectedValueOnce(new Error('ECONNRESET'));

      try {
        await useCase.execute(COUPON_INFO);
        fail('Should have thrown');
      } catch (err) {
        const se = err as ScraperError;
        expect(se.code).toBe('blocked');
        expect(se.retryable).toBe(true);
        expect(se.suggestedCooldownMs).toBe(30_000);
      }
    });
  });

  describe('onBlocked callback', () => {
    it('calls onBlocked on 503 after retries exhausted', async () => {
      const mocks = createMocks();
      const onBlocked = jest.fn().mockResolvedValue(undefined);
      mocks.retryPolicy.evaluate.mockReturnValue({ shouldRetry: false, delayMs: 0 });

      const useCase = createUseCase(mocks, { onBlocked });

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('TOKEN');
      mocks.httpClient.post.mockResolvedValueOnce({ status: 503, data: '' });

      await expect(useCase.execute(COUPON_INFO)).rejects.toMatchObject({ code: 'blocked' });
      expect(onBlocked).toHaveBeenCalledTimes(1);
    });

    it('calls onBlocked on session_expired', async () => {
      const mocks = createMocks();
      const onBlocked = jest.fn().mockResolvedValue(undefined);

      const useCase = createUseCase(mocks, { onBlocked });

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon</html>'))
        .mockResolvedValueOnce(ok('<html>coupon refresh</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('TOKEN');

      mocks.httpClient.post
        .mockResolvedValueOnce({ status: 403, data: '' })
        .mockResolvedValueOnce({ status: 403, data: '' });

      await expect(useCase.execute(COUPON_INFO)).rejects.toMatchObject({ code: 'session_expired' });
      expect(onBlocked).toHaveBeenCalledTimes(1);
      expect(onBlocked).toHaveBeenCalledWith(expect.objectContaining({ code: 'session_expired' }));
    });

    it('ignores exceptions thrown by onBlocked callback', async () => {
      const mocks = createMocks();
      const onBlocked = jest.fn().mockRejectedValue(new Error('callback crash'));
      mocks.retryPolicy.evaluate.mockReturnValue({ shouldRetry: false, delayMs: 0 });

      const useCase = createUseCase(mocks, { onBlocked });

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('TOKEN');
      mocks.httpClient.post.mockResolvedValueOnce({ status: 503, data: '' });

      try {
        await useCase.execute(COUPON_INFO);
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ScraperError);
        expect((err as ScraperError).code).toBe('blocked');
      }
      expect(onBlocked).toHaveBeenCalledTimes(1);
    });
  });

  describe('sortId loop-guard', () => {
    it('stops pagination when sortId repeats with different ASINs', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon</html>'));

      mocks.htmlParser.extractCsrfToken.mockReturnValue('TOKEN');

      mocks.httpClient.post
        .mockResolvedValueOnce(productListResponse([makeProductItem('B001', 100)]))
        .mockResolvedValueOnce(productListResponse([makeProductItem('B002', 100)]));

      const result = await useCase.execute(COUPON_INFO);

      expect(result.totalProducts).toBe(2);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'sortId loop detected, stopping pagination',
        expect.objectContaining({ sortId: '[100]' }),
      );
    });
  });

  describe('reachBottom pagination stop', () => {
    it('stops pagination when reachBottom is true in the response', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon</html>'));

      mocks.htmlParser.extractCsrfToken.mockReturnValue('TOKEN');

      mocks.httpClient.post
        .mockResolvedValueOnce(productListResponse([
          makeProductItem('B001', 100),
          makeProductItem('B002', 200),
        ]))
        .mockResolvedValueOnce(productListResponse([
          makeProductItem('B003', 300),
        ], true));

      const result = await useCase.execute(COUPON_INFO);

      expect(result.totalProducts).toBe(3);
      expect(mocks.httpClient.post).toHaveBeenCalledTimes(2);
      expect(mocks.logger.info).toHaveBeenCalledWith(
        'Pagination complete — reachBottom flag set',
        expect.objectContaining({ totalSoFar: 3 }),
      );
    });
  });

  describe('product mapping', () => {
    it('maps all fields correctly from API response', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon</html>'));

      mocks.htmlParser.extractCsrfToken.mockReturnValue('TOKEN');

      mocks.httpClient.post
        .mockResolvedValueOnce(productListResponse([makeProductItem('B0MAP', 50.5)]))
        .mockResolvedValueOnce(emptyProductList());

      const result = await useCase.execute(COUPON_INFO);

      const product = result.products[0];
      expect(product).toEqual({
        asin: 'B0MAP',
        title: 'Product B0MAP',
        price: 'R$ 10,00',
        originalPrice: 'R$ 20,00',
        prime: true,
        rating: 4.5,
        reviewCount: 100,
        badge: 'BEST_SELLER',
        url: 'https://www.amazon.com.br/dp/B0MAP',
      });
    });
  });

  describe('403/503 on coupon page GET', () => {
    it('throws blocked when coupon page returns 403', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce({ status: 403, data: '' });

      try {
        await useCase.execute(COUPON_INFO);
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ScraperError);
        expect((err as ScraperError).code).toBe('blocked');
      }
    });

    it('throws blocked when coupon page returns 503', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce({ status: 503, data: '' });

      try {
        await useCase.execute(COUPON_INFO);
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ScraperError);
        expect((err as ScraperError).code).toBe('blocked');
      }
    });
  });

  describe('invalid JSON in pagination response', () => {
    it('throws blocked when POST returns non-JSON body', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon</html>'));

      mocks.htmlParser.extractCsrfToken.mockReturnValue('TOKEN');

      mocks.httpClient.post.mockResolvedValueOnce(ok('<html>not json</html>'));

      try {
        await useCase.execute(COUPON_INFO);
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ScraperError);
        expect((err as ScraperError).code).toBe('blocked');
        expect((err as ScraperError).context?.reason).toBe('Invalid JSON response');
      }
    });
  });

  describe('payload correctness', () => {
    it('sends correct form payload including promotionMerchantId', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon</html>'));

      mocks.htmlParser.extractCsrfToken.mockReturnValue('MY_TOKEN');

      mocks.httpClient.post.mockResolvedValueOnce(emptyProductList());

      await useCase.execute(COUPON_INFO);

      expect(mocks.httpClient.post).toHaveBeenCalledWith(
        'https://www.amazon.com.br/promotion/psp/productInfoList',
        expect.objectContaining({
          promotionId: 'PROMO123',
          redirectAsin: 'B0TEST',
          redirectMerchantId: 'MERCH1',
          promotionMerchantId: 'MERCH1',
          'anti-csrftoken-a2z': 'MY_TOKEN',
          isPrimeShippingEligible: 'true',
        }),
        { formEncoded: true },
        expect.any(Object),
      );
    });
  });

  describe('ASIN deduplication', () => {
    it('skips duplicate ASINs across pages', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('TOKEN');

      mocks.httpClient.post
        .mockResolvedValueOnce(productListResponse([
          makeProductItem('B001', 100),
          makeProductItem('B002', 200),
        ]))
        .mockResolvedValueOnce(productListResponse([
          makeProductItem('B002', 300),
          makeProductItem('B003', 400),
        ]))
        .mockResolvedValueOnce(emptyProductList());

      const result = await useCase.execute(COUPON_INFO);

      expect(result.totalProducts).toBe(3);
      expect(result.products.map(p => p.asin)).toEqual(['B001', 'B002', 'B003']);
    });

    it('stops when entire page is duplicates (API cycling)', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('TOKEN');

      mocks.httpClient.post
        .mockResolvedValueOnce(productListResponse([
          makeProductItem('B001', 100),
          makeProductItem('B002', 200),
        ]))
        .mockResolvedValueOnce(productListResponse([
          makeProductItem('B001', 300),
          makeProductItem('B002', 400),
        ]));

      const result = await useCase.execute(COUPON_INFO);

      expect(result.totalProducts).toBe(2);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'All products in page already seen — API cycling detected, stopping',
        expect.objectContaining({ totalProducts: 2 }),
      );
    });
  });

  describe('maxProducts limit', () => {
    it('stops when maxProducts is reached', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks, { paginationLimits: { maxProducts: 3 } });

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('TOKEN');

      mocks.httpClient.post
        .mockResolvedValueOnce(productListResponse([
          makeProductItem('B001', 100),
          makeProductItem('B002', 200),
          makeProductItem('B003', 300),
        ]));

      const result = await useCase.execute(COUPON_INFO);

      expect(result.totalProducts).toBe(3);
      expect(mocks.httpClient.post).toHaveBeenCalledTimes(1);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'Max products reached, stopping pagination',
        expect.objectContaining({ maxProducts: 3, totalProducts: 3 }),
      );
    });
  });

  describe('maxPages limit', () => {
    it('stops when maxPages is reached', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks, { paginationLimits: { maxPages: 2 } });

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('TOKEN');

      mocks.httpClient.post
        .mockResolvedValueOnce(productListResponse([makeProductItem('B001', 100)]))
        .mockResolvedValueOnce(productListResponse([makeProductItem('B002', 200)]));

      const result = await useCase.execute(COUPON_INFO);

      expect(result.totalProducts).toBe(2);
      expect(mocks.httpClient.post).toHaveBeenCalledTimes(2);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'Max pages reached, stopping pagination',
        expect.objectContaining({ maxPages: 2, totalProducts: 2 }),
      );
    });
  });

  describe('coupon metadata', () => {
    it('includes metadata from the initial coupon page in the result', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      const expectedMetadata: CouponMetadata = {
        title: 'Só no app: 20% off em itens Brinox',
        description: null,
        expiresAt: 'domingo 15 de março de 2026',
      };
      mocks.htmlParser.extractCouponMetadata.mockReturnValue(expectedMetadata);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon page</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('TOKEN');
      mocks.httpClient.post.mockResolvedValueOnce(emptyProductList());

      const result = await useCase.execute(COUPON_INFO);

      expect(result.metadata).toEqual(expectedMetadata);
      expect(mocks.htmlParser.extractCouponMetadata).toHaveBeenCalledWith('<html>coupon page</html>');
    });

    it('preserves initial metadata after 403 session refresh', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      const initialMetadata: CouponMetadata = {
        title: 'Cupom Original',
        description: 'Descricao original',
        expiresAt: 'domingo 15 de março de 2026',
      };
      const refreshedMetadata: CouponMetadata = {
        title: 'Cupom Refreshed',
        description: 'Descricao refreshed',
        expiresAt: 'segunda-feira 16 de março de 2026',
      };

      mocks.htmlParser.extractCouponMetadata
        .mockReturnValueOnce(initialMetadata)
        .mockReturnValueOnce(refreshedMetadata);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon page 1</html>'))
        .mockResolvedValueOnce(ok('<html>coupon page 2</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('REFRESHED_TOKEN');

      mocks.httpClient.post
        .mockResolvedValueOnce(productListResponse([makeProductItem('B001', 100)]))
        .mockResolvedValueOnce({ status: 403, data: '' })
        .mockResolvedValueOnce(productListResponse([makeProductItem('B002', 200)]))
        .mockResolvedValueOnce(emptyProductList());

      const result = await useCase.execute(COUPON_INFO);

      expect(result.metadata).toEqual(initialMetadata);
      expect(result.metadata).not.toEqual(refreshedMetadata);
    });

    it('includes metadata with all null fields when page has no metadata elements', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      const emptyMetadata: CouponMetadata = {
        title: null,
        description: null,
        expiresAt: null,
      };
      mocks.htmlParser.extractCouponMetadata.mockReturnValue(emptyMetadata);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon</html>'));
      mocks.htmlParser.extractCsrfToken.mockReturnValue('TOKEN');
      mocks.httpClient.post.mockResolvedValueOnce(emptyProductList());

      const result = await useCase.execute(COUPON_INFO);

      expect(result.metadata).toEqual(emptyMetadata);
    });
  });
});
