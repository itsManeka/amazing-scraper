import { FetchProduct } from '../../src/application/use-cases/FetchProduct';
import { HttpClient, HttpResponse } from '../../src/application/ports/HttpClient';
import { HtmlParser } from '../../src/application/ports/HtmlParser';
import { Logger } from '../../src/application/ports/Logger';
import { ProductPage } from '../../src/domain/entities';

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
  url: 'https://www.amazon.com.br/dp/B0TEST',
  offerId: undefined,
  inStock: true,
  imageUrl: 'https://m.media-amazon.com/images/I/71example.jpg',
  isPreOrder: false,
  format: 'Capa dura',
  publisher: 'Editora Exemplo',
  contributors: ['Autor Exemplo (Autor)'],
  productGroup: 'book_display_on_website',
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
  const useCase = new FetchProduct(mocks.httpClient, mocks.htmlParser, mocks.logger);
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
        expect.objectContaining({ 'user-agent': expect.any(String) }),
      );
      expect(mocks.htmlParser.extractProductInfo).toHaveBeenCalledWith(
        '<html>product</html>',
        'B0TEST',
        'https://www.amazon.com.br/dp/B0TEST',
        mocks.logger,
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
        },
      };

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>coupon product</html>'));
      mocks.htmlParser.extractProductInfo.mockReturnValue(pageWithCoupon);

      const result = await useCase.execute('B0TEST');

      expect(result.hasCoupon).toBe(true);
      expect(result.couponInfo?.promotionId).toBe('PROMO123');
    });
  });

  describe('blocking — status 503', () => {
    it('throws ScraperError "blocked" on 503', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get.mockResolvedValueOnce({ status: 503, data: '' });

      await expect(useCase.execute('B0TEST')).rejects.toMatchObject({
        code: 'blocked',
        context: expect.objectContaining({ status: 503 }),
      });
      expect(mocks.htmlParser.extractProductInfo).not.toHaveBeenCalled();
    });
  });

  describe('blocking — status 403', () => {
    it('retries once on 403 and succeeds on second attempt', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce({ status: 403, data: '' })
        .mockResolvedValueOnce(ok('<html>product</html>'));
      mocks.htmlParser.extractProductInfo.mockReturnValue(PRODUCT_PAGE);

      const result = await useCase.execute('B0TEST');

      expect(result).toEqual(PRODUCT_PAGE);
      expect(mocks.httpClient.get).toHaveBeenCalledTimes(2);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        '403 on product page, retrying in 5s',
        expect.any(Object),
      );
    });

    it('throws ScraperError "blocked" when both 403 attempts fail', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce({ status: 403, data: '' })
        .mockResolvedValueOnce({ status: 403, data: '' });

      await expect(useCase.execute('B0TEST')).rejects.toMatchObject({
        code: 'blocked',
        context: expect.objectContaining({ status: 403 }),
      });
      expect(mocks.httpClient.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('blocking — CAPTCHA', () => {
    it('throws ScraperError "blocked" when CAPTCHA is detected in 200 response', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get.mockResolvedValueOnce(
        ok('<html>Type the characters you see in this image</html>'),
      );

      await expect(useCase.execute('B0TEST')).rejects.toMatchObject({
        code: 'blocked',
        context: expect.objectContaining({ reason: 'CAPTCHA detected' }),
      });
      expect(mocks.htmlParser.extractProductInfo).not.toHaveBeenCalled();
    });

    it('throws ScraperError "blocked" on validateCaptcha marker', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get.mockResolvedValueOnce(
        ok('<html><form action="/errors/validateCaptcha"></html>'),
      );

      await expect(useCase.execute('B0TEST')).rejects.toMatchObject({ code: 'blocked' });
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
});
