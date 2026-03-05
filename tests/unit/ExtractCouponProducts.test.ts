import { ExtractCouponProducts } from '../../src/application/use-cases/ExtractCouponProducts';
import { HttpClient, HttpResponse } from '../../src/application/ports/HttpClient';
import { HtmlParser } from '../../src/application/ports/HtmlParser';
import { Logger } from '../../src/application/ports/Logger';
import { CouponInfo } from '../../src/domain/entities';
import { ScraperError } from '../../src/domain/errors';

const COUPON_INFO: CouponInfo = {
  promotionId: 'PROMO123',
  redirectAsin: 'B0TEST',
  redirectMerchantId: 'MERCH1',
  promotionMerchantId: 'MERCH1',
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

  const htmlParser: jest.Mocked<HtmlParser> = {
    extractCouponInfo: jest.fn(),
    extractCsrfToken: jest.fn(),
    extractProductInfo: jest.fn(),
  };

  const logger: jest.Mocked<Logger> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  return { httpClient, htmlParser, logger };
}

function createUseCase(mocks: ReturnType<typeof createMocks>) {
  const useCase = new ExtractCouponProducts(
    mocks.httpClient,
    mocks.htmlParser,
    mocks.logger,
    { min: 0, max: 0 },
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
      expect(result.sourceAsin).toBe('B0TEST');
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
  });

  describe('CAPTCHA detection', () => {
    it('throws blocked when CAPTCHA text marker is in pagination response', async () => {
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
        expect((err as ScraperError).code).toBe('blocked');
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
  });

  describe('403 during pagination — session refresh', () => {
    it('refreshes session and continues', async () => {
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
        expect((err as ScraperError).code).toBe('session_expired');
      }
    });
  });

  describe('sortId loop-guard', () => {
    it('stops pagination when sortId repeats', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon</html>'));

      mocks.htmlParser.extractCsrfToken.mockReturnValue('TOKEN');

      const sameItem = makeProductItem('B001', 100);

      mocks.httpClient.post
        .mockResolvedValueOnce(productListResponse([sameItem]))
        .mockResolvedValueOnce(productListResponse([sameItem]));

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

  describe('503 during pagination', () => {
    it('throws blocked on 503 in POST', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

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

  describe('POST throws network error', () => {
    it('throws blocked when httpClient.post rejects', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>coupon</html>'));

      mocks.htmlParser.extractCsrfToken.mockReturnValue('TOKEN');

      mocks.httpClient.post.mockRejectedValueOnce(new Error('ECONNRESET'));

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
});
