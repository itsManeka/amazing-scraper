import { FetchProduct } from '../../src/application/use-cases/FetchProduct';
import { HttpClient, HttpResponse } from '../../src/application/ports/HttpClient';
import { HtmlParser } from '../../src/application/ports/HtmlParser';
import { Logger } from '../../src/application/ports/Logger';
import { RetryPolicy, RetryDecision } from '../../src/application/ports/RetryPolicy';
import { UserAgentProvider } from '../../src/application/ports/UserAgentProvider';
import { SessionRecycler } from '../../src/application/services/SessionRecycler';
import { ProductPage } from '../../src/domain/entities';
import { ScraperError } from '../../src/domain/errors';

const TEST_UA = 'Mozilla/5.0 TestBrowser/1.0';

const DEGRADED_HTML = '<html><head><title></title></head><body><div id="dp-container"></div></body></html>';

const PRODUCT_PAGE: ProductPage = {
  asin: 'B0TEST',
  title: 'Produto Teste',
  price: 'R$ 99,90',
  originalPrice: 'R$ 149,90',
  prime: true,
  rating: 4.5,
  reviewCount: 1234,
  hasCoupon: false,
  couponInfo: null,
  couponInfos: [],
  url: 'https://www.amazon.com.br/dp/B0TEST',
  offerId: undefined,
  inStock: true,
  imageUrl: 'https://m.media-amazon.com/images/I/71example.jpg',
  isPreOrder: false,
  format: 'Capa dura',
  publisher: 'Editora Exemplo',
  contributors: ['Autor Exemplo (Autor)'],
  productGroup: 'Book',
};

function ok(data: string): HttpResponse {
  return { status: 200, data };
}

function createMocks() {
  const httpClient: jest.Mocked<HttpClient> = {
    get: jest.fn(),
    post: jest.fn(),
  };

  const htmlParser: jest.Mocked<HtmlParser> = {
    extractCouponInfo: jest.fn(),
    extractIndividualCouponInfo: jest.fn(),
    extractIndividualCouponTerms: jest.fn(),
    extractIndividualCouponExpiration: jest.fn().mockReturnValue(null),
    extractCsrfToken: jest.fn(),
    extractCouponMetadata: jest.fn(),
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
  onBlocked?: (error: ScraperError) => Promise<void>,
  sessionRecycler?: SessionRecycler,
) {
  const useCase = new FetchProduct(
    mocks.httpClient,
    mocks.htmlParser,
    mocks.logger,
    mocks.userAgentProvider,
    mocks.retryPolicy,
    onBlocked,
    sessionRecycler,
  );
  jest.spyOn(useCase as never, 'delay' as never).mockResolvedValue(undefined as never);
  return useCase;
}

describe('FetchProduct', () => {
  describe('success', () => {
    it('fetches the product page and returns structured data', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>product</html>'));
      mocks.htmlParser.extractProductInfo.mockReturnValue(PRODUCT_PAGE);

      const result = await useCase.execute('B0TEST');

      expect(result).toEqual(PRODUCT_PAGE);
      expect(mocks.httpClient.get).toHaveBeenCalledTimes(1);
      expect(mocks.httpClient.get).toHaveBeenCalledWith(
        'https://www.amazon.com.br/dp/B0TEST',
        expect.objectContaining({ 'user-agent': TEST_UA }),
      );
      expect(mocks.htmlParser.extractProductInfo).toHaveBeenCalledWith(
        '<html>product</html>',
        'B0TEST',
        'https://www.amazon.com.br/dp/B0TEST',
        mocks.logger,
      );
    });

    it('uses the UA from userAgentProvider', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>product</html>'));
      mocks.htmlParser.extractProductInfo.mockReturnValue(PRODUCT_PAGE);

      await useCase.execute('B0TEST');

      expect(mocks.userAgentProvider.get).toHaveBeenCalledTimes(1);
      expect(mocks.httpClient.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ 'user-agent': TEST_UA }),
      );
    });

    it('logs asin, title and hasCoupon after successful fetch', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>product</html>'));
      mocks.htmlParser.extractProductInfo.mockReturnValue(PRODUCT_PAGE);

      await useCase.execute('B0TEST');

      expect(mocks.logger.info).toHaveBeenCalledWith(
        'Product page fetched',
        expect.objectContaining({ asin: 'B0TEST', title: PRODUCT_PAGE.title, hasCoupon: false }),
      );
    });

    it('returns hasCoupon: true when parser finds coupon info', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      const pageWithCoupon: ProductPage = {
        ...PRODUCT_PAGE,
        hasCoupon: true,
        couponInfo: {
          promotionId: 'PROMO123',
          redirectAsin: 'B0TEST',
          redirectMerchantId: 'MERCH1',
          promotionMerchantId: 'MERCH1',
          couponCode: null,
        },
        couponInfos: [
          {
            promotionId: 'PROMO123',
            redirectAsin: 'B0TEST',
            redirectMerchantId: 'MERCH1',
            promotionMerchantId: 'MERCH1',
            couponCode: null,
          },
        ],
      };

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>coupon product</html>'));
      mocks.htmlParser.extractProductInfo.mockReturnValue(pageWithCoupon);

      const result = await useCase.execute('B0TEST');

      expect(result.hasCoupon).toBe(true);
      expect(result.couponInfo?.promotionId).toBe('PROMO123');
    });

    it('returns individualCouponInfo when parser detects an inline individual coupon', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      const pageWithIndividual: ProductPage = {
        ...PRODUCT_PAGE,
        hasCoupon: false,
        couponInfo: null,
        individualCouponInfo: {
          promotionId: 'ATVO4IBO0PTIE',
          couponCode: 'VEMNOAPP',
          discountText: 'R$20',
          description: 'Insira o código VEMNOAPP na hora do pagamento.',
          termsUrl: '/promotion/details/popup/ATVO4IBO0PTIE?ref=x',
          isIndividual: true,
        },
      };

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>individual coupon</html>'));
      mocks.htmlParser.extractProductInfo.mockReturnValue(pageWithIndividual);

      const result = await useCase.execute('B0TEST');

      expect(result.couponInfo).toBeNull();
      expect(result.individualCouponInfo).not.toBeNull();
      expect(result.individualCouponInfo!.promotionId).toBe('ATVO4IBO0PTIE');
      expect(result.individualCouponInfo!.couponCode).toBe('VEMNOAPP');
    });
  });

  describe('retry via RetryPolicy — 403', () => {
    it('retries on 403 when retryPolicy says to retry, then succeeds', async () => {
      const mocks = createMocks();
      mocks.retryPolicy.evaluate
        .mockReturnValueOnce({ shouldRetry: true, delayMs: 2000 })
        .mockReturnValueOnce({ shouldRetry: false, delayMs: 0 });

      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce({ status: 403, data: '' })
        .mockResolvedValueOnce(ok('<html>product</html>'));
      mocks.htmlParser.extractProductInfo.mockReturnValue(PRODUCT_PAGE);

      const result = await useCase.execute('B0TEST');

      expect(result).toEqual(PRODUCT_PAGE);
      expect(mocks.httpClient.get).toHaveBeenCalledTimes(2);
      expect(mocks.retryPolicy.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({ attempt: 0, statusCode: 403, errorType: 'http' }),
      );
    });

    it('throws blocked with retryable: false when retries exhausted on 403', async () => {
      const mocks = createMocks();
      mocks.retryPolicy.evaluate.mockReturnValue({ shouldRetry: false, delayMs: 0 });

      const useCase = createUseCase(mocks);

      mocks.httpClient.get.mockResolvedValueOnce({ status: 403, data: '' });

      try {
        await useCase.execute('B0TEST');
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ScraperError);
        const se = err as ScraperError;
        expect(se.code).toBe('blocked');
        expect(se.context).toEqual(expect.objectContaining({ status: 403 }));
        expect(se.retryable).toBe(false);
      }
    });
  });

  describe('retry via RetryPolicy — 503', () => {
    it('retries on 503 when retryPolicy says to retry, then succeeds', async () => {
      const mocks = createMocks();
      mocks.retryPolicy.evaluate
        .mockReturnValueOnce({ shouldRetry: true, delayMs: 2000 });

      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce({ status: 503, data: '' })
        .mockResolvedValueOnce(ok('<html>product</html>'));
      mocks.htmlParser.extractProductInfo.mockReturnValue(PRODUCT_PAGE);

      const result = await useCase.execute('B0TEST');

      expect(result).toEqual(PRODUCT_PAGE);
      expect(mocks.retryPolicy.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 503, errorType: 'http' }),
      );
    });

    it('throws blocked with retryable: true and suggestedCooldownMs when retries exhausted on 503', async () => {
      const mocks = createMocks();
      mocks.retryPolicy.evaluate.mockReturnValue({ shouldRetry: false, delayMs: 0 });

      const useCase = createUseCase(mocks);

      mocks.httpClient.get.mockResolvedValueOnce({ status: 503, data: '' });

      try {
        await useCase.execute('B0TEST');
        fail('Should have thrown');
      } catch (err) {
        const se = err as ScraperError;
        expect(se.code).toBe('blocked');
        expect(se.retryable).toBe(true);
        expect(se.suggestedCooldownMs).toBe(30_000);
      }
    });
  });

  describe('retry via RetryPolicy — network error', () => {
    it('retries on network error when retryPolicy says to retry', async () => {
      const mocks = createMocks();
      mocks.retryPolicy.evaluate
        .mockReturnValueOnce({ shouldRetry: true, delayMs: 2000 });

      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce(ok('<html>product</html>'));
      mocks.htmlParser.extractProductInfo.mockReturnValue(PRODUCT_PAGE);

      const result = await useCase.execute('B0TEST');

      expect(result).toEqual(PRODUCT_PAGE);
      expect(mocks.retryPolicy.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 0, errorType: 'network' }),
      );
    });

    it('throws blocked when network retries exhausted', async () => {
      const mocks = createMocks();
      mocks.retryPolicy.evaluate.mockReturnValue({ shouldRetry: false, delayMs: 0 });

      const useCase = createUseCase(mocks);

      mocks.httpClient.get.mockRejectedValueOnce(new Error('ECONNRESET'));

      try {
        await useCase.execute('B0TEST');
        fail('Should have thrown');
      } catch (err) {
        const se = err as ScraperError;
        expect(se.code).toBe('blocked');
        expect(se.retryable).toBe(true);
        expect(se.suggestedCooldownMs).toBe(30_000);
      }
    });
  });

  describe('CAPTCHA detection', () => {
    it('throws blocked with retryable: true and suggestedCooldownMs: 120000 on CAPTCHA', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get.mockResolvedValueOnce(
        ok('<html>Type the characters you see in this image</html>'),
      );

      try {
        await useCase.execute('B0TEST');
        fail('Should have thrown');
      } catch (err) {
        const se = err as ScraperError;
        expect(se.code).toBe('blocked');
        expect(se.retryable).toBe(true);
        expect(se.suggestedCooldownMs).toBe(120_000);
        expect(se.context).toEqual(expect.objectContaining({ reason: 'CAPTCHA detected' }));
      }
      expect(mocks.htmlParser.extractProductInfo).not.toHaveBeenCalled();
    });

    it('throws on validateCaptcha marker', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get.mockResolvedValueOnce(
        ok('<html><form action="/errors/validateCaptcha"></html>'),
      );

      await expect(useCase.execute('B0TEST')).rejects.toMatchObject({ code: 'blocked' });
    });
  });

  describe('onBlocked callback', () => {
    it('calls onBlocked before throwing on CAPTCHA', async () => {
      const mocks = createMocks();
      const onBlocked = jest.fn().mockResolvedValue(undefined);
      const useCase = createUseCase(mocks, onBlocked);

      mocks.httpClient.get.mockResolvedValueOnce(
        ok('<html>Type the characters you see in this image</html>'),
      );

      await expect(useCase.execute('B0TEST')).rejects.toMatchObject({ code: 'blocked' });
      expect(onBlocked).toHaveBeenCalledTimes(1);
      expect(onBlocked).toHaveBeenCalledWith(expect.objectContaining({ code: 'blocked' }));
    });

    it('calls onBlocked before throwing on 403 after retries exhausted', async () => {
      const mocks = createMocks();
      const onBlocked = jest.fn().mockResolvedValue(undefined);
      mocks.retryPolicy.evaluate.mockReturnValue({ shouldRetry: false, delayMs: 0 });

      const useCase = createUseCase(mocks, onBlocked);

      mocks.httpClient.get.mockResolvedValueOnce({ status: 403, data: '' });

      await expect(useCase.execute('B0TEST')).rejects.toMatchObject({ code: 'blocked' });
      expect(onBlocked).toHaveBeenCalledTimes(1);
    });

    it('calls onBlocked before throwing on 503 after retries exhausted', async () => {
      const mocks = createMocks();
      const onBlocked = jest.fn().mockResolvedValue(undefined);
      mocks.retryPolicy.evaluate.mockReturnValue({ shouldRetry: false, delayMs: 0 });

      const useCase = createUseCase(mocks, onBlocked);

      mocks.httpClient.get.mockResolvedValueOnce({ status: 503, data: '' });

      await expect(useCase.execute('B0TEST')).rejects.toMatchObject({ code: 'blocked' });
      expect(onBlocked).toHaveBeenCalledTimes(1);
    });

    it('ignores exceptions thrown by onBlocked callback', async () => {
      const mocks = createMocks();
      const onBlocked = jest.fn().mockRejectedValue(new Error('callback crash'));
      mocks.retryPolicy.evaluate.mockReturnValue({ shouldRetry: false, delayMs: 0 });

      const useCase = createUseCase(mocks, onBlocked);

      mocks.httpClient.get.mockResolvedValueOnce({ status: 503, data: '' });

      try {
        await useCase.execute('B0TEST');
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ScraperError);
        expect((err as ScraperError).code).toBe('blocked');
      }
      expect(onBlocked).toHaveBeenCalledTimes(1);
    });

    it('does not call onBlocked on success', async () => {
      const mocks = createMocks();
      const onBlocked = jest.fn().mockResolvedValue(undefined);
      const useCase = createUseCase(mocks, onBlocked);

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>product</html>'));
      mocks.htmlParser.extractProductInfo.mockReturnValue(PRODUCT_PAGE);

      await useCase.execute('B0TEST');

      expect(onBlocked).not.toHaveBeenCalled();
    });
  });

  describe('logging', () => {
    it('logs start with asin and url', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>product</html>'));
      mocks.htmlParser.extractProductInfo.mockReturnValue(PRODUCT_PAGE);

      await useCase.execute('B0TEST');

      expect(mocks.logger.info).toHaveBeenCalledWith(
        'Fetching product page',
        expect.objectContaining({
          asin: 'B0TEST',
          url: 'https://www.amazon.com.br/dp/B0TEST',
        }),
      );
    });
  });

  describe('RG3 — UA per-request (T3)', () => {
    it('calls userAgentProvider.get() once per execute() call', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>product 1</html>'));
      mocks.htmlParser.extractProductInfo.mockReturnValue(PRODUCT_PAGE);

      await useCase.execute('B0TEST1');
      expect(mocks.userAgentProvider.get).toHaveBeenCalledTimes(1);

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>product 2</html>'));
      await useCase.execute('B0TEST2');
      expect(mocks.userAgentProvider.get).toHaveBeenCalledTimes(2);
    });

    it('uses different UAs for consecutive requests when provider returns different values', async () => {
      const mocks = createMocks();
      const ua1 = 'Mozilla/5.0 Browser1';
      const ua2 = 'Mozilla/5.0 Browser2';

      mocks.userAgentProvider.get.mockReturnValueOnce(ua1).mockReturnValueOnce(ua2);
      const useCase = createUseCase(mocks);

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>product 1</html>'));
      mocks.htmlParser.extractProductInfo.mockReturnValue(PRODUCT_PAGE);

      await useCase.execute('B0TEST1');
      const firstCall = mocks.httpClient.get.mock.calls[0];
      const firstHeaders = firstCall[1] as Record<string, string>;
      expect(firstHeaders['user-agent']).toBe(ua1);

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>product 2</html>'));
      await useCase.execute('B0TEST2');
      const secondCall = mocks.httpClient.get.mock.calls[1];
      const secondHeaders = secondCall[1] as Record<string, string>;
      expect(secondHeaders['user-agent']).toBe(ua2);
    });
  });

  describe('T5 — Deteccao reativa de degrade + retry (reactive mode)', () => {
    it('detects degraded page, resets session, retries with fresh UA, and succeeds', async () => {
      const mocks = createMocks();
      // Add resetSession to the mock
      const resetSessionMock = jest.fn();
      Object.defineProperty(mocks.httpClient, 'resetSession', {
        value: resetSessionMock,
        writable: true,
        enumerable: true,
        configurable: true,
      });

      const sessionRecycler = new SessionRecycler(mocks.httpClient, 5, mocks.logger);
      const useCase = createUseCase(mocks, undefined, sessionRecycler);

      // First request returns degraded HTML
      mocks.httpClient.get.mockResolvedValueOnce(ok(DEGRADED_HTML));
      // Second request (after reset) returns healthy HTML
      mocks.httpClient.get.mockResolvedValueOnce(ok('<html><head><title>Product</title></head><body><span id="productTitle">Test</span><span class="a-price"><span class="a-offscreen">R$ 99,90</span></span></body></html>'));
      mocks.htmlParser.extractProductInfo.mockReturnValue(PRODUCT_PAGE);

      const result = await useCase.execute('B0TEST');

      expect(result).toEqual(PRODUCT_PAGE);
      // Should call httpClient.get twice: first degraded, then retry
      expect(mocks.httpClient.get).toHaveBeenCalledTimes(2);
      // resetSession should be called once (reactive reset)
      expect(resetSessionMock).toHaveBeenCalledTimes(1);
      // Should log degrade detection
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/degrade/i),
        expect.any(Object),
      );
      // userAgentProvider should be called twice (once per request)
      expect(mocks.userAgentProvider.get).toHaveBeenCalledTimes(2);
    });

    it('handles double-degrade: both requests degraded, resets once, parser processes degraded HTML', async () => {
      const mocks = createMocks();
      // Add resetSession to the mock
      const resetSessionMock = jest.fn();
      Object.defineProperty(mocks.httpClient, 'resetSession', {
        value: resetSessionMock,
        writable: true,
        enumerable: true,
        configurable: true,
      });

      const sessionRecycler = new SessionRecycler(mocks.httpClient, 5, mocks.logger);
      const useCase = createUseCase(mocks, undefined, sessionRecycler);

      // Both requests return degraded HTML
      mocks.httpClient.get.mockResolvedValueOnce(ok(DEGRADED_HTML));
      mocks.httpClient.get.mockResolvedValueOnce(ok(DEGRADED_HTML));
      // Parser returns price: null (indicating price extraction failed)
      const degradedPage = { ...PRODUCT_PAGE, price: null };
      mocks.htmlParser.extractProductInfo.mockReturnValue(degradedPage);

      const result = await useCase.execute('B0TEST');

      expect(result.price).toBeNull();
      // Should call httpClient.get twice (first + retry)
      expect(mocks.httpClient.get).toHaveBeenCalledTimes(2);
      // resetSession should be called once (only reactive, no second retry)
      expect(resetSessionMock).toHaveBeenCalledTimes(1);
      // Parser still runs on degraded HTML
      expect(mocks.htmlParser.extractProductInfo).toHaveBeenCalledTimes(1);
    });

    it('does not retry or reset when first request is healthy (no degrade detected)', async () => {
      const mocks = createMocks();
      const mockHttpClient = {
        ...mocks.httpClient,
        resetSession: jest.fn(),
      };
      const sessionRecycler = new SessionRecycler(mockHttpClient as never, 5, mocks.logger);
      const useCase = createUseCase(mocks, undefined, sessionRecycler);

      // Healthy HTML
      mockHttpClient.get.mockResolvedValueOnce(ok('<html><head><title>Product</title></head><body><span id="productTitle">Test</span><span class="a-price"><span class="a-offscreen">R$ 99,90</span></span></body></html>'));
      mocks.htmlParser.extractProductInfo.mockReturnValue(PRODUCT_PAGE);

      const result = await useCase.execute('B0TEST');

      expect(result).toEqual(PRODUCT_PAGE);
      // Should call httpClient.get only once (no retry)
      expect(mockHttpClient.get).toHaveBeenCalledTimes(1);
      // resetSession should NOT be called
      expect(mockHttpClient.resetSession).not.toHaveBeenCalled();
      // userAgentProvider called once
      expect(mocks.userAgentProvider.get).toHaveBeenCalledTimes(1);
    });

    it('handles httpClient.resetSession undefined gracefully (custom HttpClient) — FINDING 3: no retry without resetSession', async () => {
      const mocks = createMocks();
      // httpClient without resetSession method
      const customHttpClient: HttpClient = {
        get: mocks.httpClient.get,
        post: mocks.httpClient.post,
      };
      const sessionRecycler = new SessionRecycler(customHttpClient, 5, mocks.logger);
      const useCase = createUseCase(mocks, undefined, sessionRecycler);

      // First request returns degraded HTML
      mocks.httpClient.get.mockResolvedValueOnce(ok(DEGRADED_HTML));
      const degradedPage = { ...PRODUCT_PAGE, price: null };
      mocks.htmlParser.extractProductInfo.mockReturnValue(degradedPage);

      const result = await useCase.execute('B0TEST');

      expect(result.price).toBeNull();
      // FINDING 3: Should make only 1 request (NO retry without resetSession)
      expect(mocks.httpClient.get).toHaveBeenCalledTimes(1);
      // Should log warn about missing resetSession
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/resetSession.*not available/i),
        expect.any(Object),
      );
    });

    it('logs warn message when degrade is detected', async () => {
      const mocks = createMocks();
      // Add resetSession to the mock
      const resetSessionMock = jest.fn();
      Object.defineProperty(mocks.httpClient, 'resetSession', {
        value: resetSessionMock,
        writable: true,
        enumerable: true,
        configurable: true,
      });

      const sessionRecycler = new SessionRecycler(mocks.httpClient, 5, mocks.logger);
      const useCase = createUseCase(mocks, undefined, sessionRecycler);

      mocks.httpClient.get.mockResolvedValueOnce(ok(DEGRADED_HTML));
      mocks.httpClient.get.mockResolvedValueOnce(ok('<html><head><title>Product</title></head><body><span id="productTitle">Test</span><span class="a-price"><span class="a-offscreen">R$ 99,90</span></span></body></html>'));
      mocks.htmlParser.extractProductInfo.mockReturnValue(PRODUCT_PAGE);

      await useCase.execute('B0TEST');

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'Page appears degraded — retrying with fresh session',
        expect.objectContaining({ asin: 'B0TEST', url: 'https://www.amazon.com.br/dp/B0TEST' }),
      );
    });
  });

  describe('T5 — reactive=false (legacy mode)', () => {
    it('does not detect degrade or retry when reactive=false', async () => {
      const mocks = createMocks();
      // Add resetSession to the mock
      const resetSessionMock = jest.fn();
      Object.defineProperty(mocks.httpClient, 'resetSession', {
        value: resetSessionMock,
        writable: true,
        enumerable: true,
        configurable: true,
      });

      const sessionRecycler = new SessionRecycler(mocks.httpClient, 5, mocks.logger);
      // Create use case with reactive=false
      const useCase = new FetchProduct(
        mocks.httpClient,
        mocks.htmlParser,
        mocks.logger,
        mocks.userAgentProvider,
        mocks.retryPolicy,
        undefined,
        sessionRecycler,
        false, // reactive = false
      );
      jest.spyOn(useCase as never, 'delay' as never).mockResolvedValue(undefined as never);

      // Degraded HTML
      mocks.httpClient.get.mockResolvedValueOnce(ok(DEGRADED_HTML));
      const degradedPage = { ...PRODUCT_PAGE, price: null };
      mocks.htmlParser.extractProductInfo.mockReturnValue(degradedPage);

      const result = await useCase.execute('B0TEST');

      expect(result.price).toBeNull();
      // Should call httpClient.get only once (no retry)
      expect(mocks.httpClient.get).toHaveBeenCalledTimes(1);
      // resetSession should NOT be called
      expect(resetSessionMock).not.toHaveBeenCalled();
    });
  });

  describe('FINDING 2 — assertNoCaptcha on retry response', () => {
    it('throws blocked when retry response contains CAPTCHA (not degraded HTML)', async () => {
      const mocks = createMocks();
      const resetSessionMock = jest.fn();
      Object.defineProperty(mocks.httpClient, 'resetSession', {
        value: resetSessionMock,
        writable: true,
        enumerable: true,
        configurable: true,
      });

      const sessionRecycler = new SessionRecycler(mocks.httpClient, 5, mocks.logger);
      const useCase = createUseCase(mocks, undefined, sessionRecycler);

      // First request returns degraded HTML (missing prices)
      mocks.httpClient.get.mockResolvedValueOnce(ok(DEGRADED_HTML));
      // Second request (after reset) returns CAPTCHA
      mocks.httpClient.get.mockResolvedValueOnce(
        ok('<html>Type the characters you see in this image</html>'),
      );

      await expect(useCase.execute('B0TEST')).rejects.toMatchObject({
        code: 'blocked',
        context: expect.objectContaining({ reason: 'CAPTCHA detected' }),
      });

      // Should have made 2 requests (first degraded, then retry with CAPTCHA)
      expect(mocks.httpClient.get).toHaveBeenCalledTimes(2);
      // resetSession should have been called once
      expect(resetSessionMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('FINDING 3 — Retry only when resetSession is available', () => {
    it('does not retry when httpClient.resetSession is undefined, even with sessionRecycler', async () => {
      const mocks = createMocks();
      // No resetSession method on httpClient
      const customHttpClient: HttpClient = {
        get: mocks.httpClient.get,
        post: mocks.httpClient.post,
      };

      const sessionRecycler = new SessionRecycler(customHttpClient, 5, mocks.logger);
      // Create use case with custom http client (no resetSession)
      const useCase = new FetchProduct(
        customHttpClient,
        mocks.htmlParser,
        mocks.logger,
        mocks.userAgentProvider,
        mocks.retryPolicy,
        undefined,
        sessionRecycler,
      );
      jest.spyOn(useCase as never, 'delay' as never).mockResolvedValue(undefined as never);

      // Degraded HTML
      mocks.httpClient.get.mockResolvedValueOnce(ok(DEGRADED_HTML));
      const degradedPage = { ...PRODUCT_PAGE, price: null };
      mocks.htmlParser.extractProductInfo.mockReturnValue(degradedPage);

      const result = await useCase.execute('B0TEST');

      expect(result.price).toBeNull();
      // Should call httpClient.get only once (no retry because resetSession missing)
      expect(mocks.httpClient.get).toHaveBeenCalledTimes(1);
      // Should log warn about resetSession missing
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/resetSession.*not available/i),
        expect.any(Object),
      );
    });

    it('logs warn when degrade detected but resetSession unavailable', async () => {
      const mocks = createMocks();
      // Custom HttpClient without resetSession
      const customHttpClient: HttpClient = {
        get: mocks.httpClient.get,
        post: mocks.httpClient.post,
      };

      const sessionRecycler = new SessionRecycler(customHttpClient, 5, mocks.logger);
      const useCase = new FetchProduct(
        customHttpClient,
        mocks.htmlParser,
        mocks.logger,
        mocks.userAgentProvider,
        mocks.retryPolicy,
        undefined,
        sessionRecycler,
      );
      jest.spyOn(useCase as never, 'delay' as never).mockResolvedValue(undefined as never);

      mocks.httpClient.get.mockResolvedValueOnce(ok(DEGRADED_HTML));
      const degradedPage = { ...PRODUCT_PAGE, price: null };
      mocks.htmlParser.extractProductInfo.mockReturnValue(degradedPage);

      await useCase.execute('B0TEST');

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/resetSession.*not available/i),
        expect.objectContaining({ reason: 'HttpClient must implement resetSession for reactive retry' }),
      );
    });
  });
});
