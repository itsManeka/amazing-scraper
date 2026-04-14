import { FetchPreSales } from '../../src/application/use-cases/FetchPreSales';
import { HttpClient, HttpResponse } from '../../src/application/ports/HttpClient';
import { HtmlParser } from '../../src/application/ports/HtmlParser';
import { Logger } from '../../src/application/ports/Logger';
import { RetryPolicy, RetryDecision } from '../../src/application/ports/RetryPolicy';
import { UserAgentProvider } from '../../src/application/ports/UserAgentProvider';
import { ScraperError } from '../../src/domain/errors';
import { PRE_SALES_URL } from '../../src/infrastructure/http/amazonConstants';

const TEST_UA = 'Mozilla/5.0 TestBrowser/1.0';

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
) {
  const useCase = new FetchPreSales(
    mocks.httpClient,
    mocks.htmlParser,
    mocks.logger,
    mocks.userAgentProvider,
    mocks.retryPolicy,
    onBlocked,
    { min: 100, max: 100 },
  );
  jest.spyOn(useCase as never, 'delay' as never).mockResolvedValue(undefined as never);
  return useCase;
}

describe('FetchPreSales', () => {
  describe('success — single page', () => {
    it('fetches one page and returns ASINs', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>page1</html>'));
      mocks.htmlParser.extractSearchResultAsins.mockReturnValueOnce(['B0A', 'B0B', 'B0C']);
      mocks.htmlParser.hasNextSearchPage.mockReturnValueOnce(false);

      const result = await useCase.execute({ limit: 1 });

      expect(result.asins).toEqual(['B0A', 'B0B', 'B0C']);
      expect(mocks.httpClient.get).toHaveBeenCalledTimes(1);
      expect(mocks.httpClient.get).toHaveBeenCalledWith(
        PRE_SALES_URL,
        expect.objectContaining({ 'user-agent': TEST_UA }),
      );
    });
  });

  describe('success — multi-page with delay between pages', () => {
    it('fetches multiple pages with correct URLs', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>page1</html>'))
        .mockResolvedValueOnce(ok('<html>page2</html>'))
        .mockResolvedValueOnce(ok('<html>page3</html>'));

      mocks.htmlParser.extractSearchResultAsins
        .mockReturnValueOnce(['B0A1', 'B0A2'])
        .mockReturnValueOnce(['B0B1', 'B0B2'])
        .mockReturnValueOnce(['B0C1']);

      mocks.htmlParser.hasNextSearchPage
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      const result = await useCase.execute({ limit: 3 });

      expect(result.asins).toEqual(['B0A1', 'B0A2', 'B0B1', 'B0B2', 'B0C1']);
      expect(mocks.httpClient.get).toHaveBeenCalledTimes(3);
      expect(mocks.httpClient.get).toHaveBeenNthCalledWith(1, PRE_SALES_URL, expect.any(Object));
      expect(mocks.httpClient.get).toHaveBeenNthCalledWith(2, `${PRE_SALES_URL}&page=2`, expect.any(Object));
      expect(mocks.httpClient.get).toHaveBeenNthCalledWith(3, `${PRE_SALES_URL}&page=3`, expect.any(Object));
    });

    it('calls delay between page requests but not before the first', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);
      const delaySpy = jest.spyOn(useCase as never, 'randomDelay' as never);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>page1</html>'))
        .mockResolvedValueOnce(ok('<html>page2</html>'));

      mocks.htmlParser.extractSearchResultAsins
        .mockReturnValueOnce(['B0A'])
        .mockReturnValueOnce(['B0B']);

      mocks.htmlParser.hasNextSearchPage
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      await useCase.execute({ limit: 2 });

      expect(delaySpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('stopAtAsin — found as the very first ASIN on a page', () => {
    it('returns empty when stopAtAsin is the first ASIN on the first page', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>page1</html>'));
      mocks.htmlParser.extractSearchResultAsins.mockReturnValueOnce(['B0STOP', 'B0A', 'B0B']);
      mocks.htmlParser.hasNextSearchPage.mockReturnValueOnce(true);

      const result = await useCase.execute({ stopAtAsin: 'B0STOP' });

      expect(result.asins).toEqual([]);
      expect(mocks.httpClient.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('stopAtAsin — found in the middle of a page', () => {
    it('returns only ASINs before the sentinel', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>page1</html>'));
      mocks.htmlParser.extractSearchResultAsins.mockReturnValueOnce(['B0A', 'B0B', 'B0STOP', 'B0C']);
      mocks.htmlParser.hasNextSearchPage.mockReturnValueOnce(true);

      const result = await useCase.execute({ stopAtAsin: 'B0STOP' });

      expect(result.asins).toEqual(['B0A', 'B0B']);
      expect(mocks.httpClient.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('stopAtAsin — found on a second page', () => {
    it('collects first page ASINs and stops at sentinel on second page', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>page1</html>'))
        .mockResolvedValueOnce(ok('<html>page2</html>'));

      mocks.htmlParser.extractSearchResultAsins
        .mockReturnValueOnce(['B0A', 'B0B'])
        .mockReturnValueOnce(['B0C', 'B0STOP', 'B0D']);

      mocks.htmlParser.hasNextSearchPage
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true);

      const result = await useCase.execute({ stopAtAsin: 'B0STOP' });

      expect(result.asins).toEqual(['B0A', 'B0B', 'B0C']);
      expect(mocks.httpClient.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('limit enforcement', () => {
    it('fetches exactly 5 pages (default limit) and stops even when hasNextSearchPage returns true', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      for (let i = 0; i < 5; i++) {
        mocks.httpClient.get.mockResolvedValueOnce(ok(`<html>page${i + 1}</html>`));
        mocks.htmlParser.extractSearchResultAsins.mockReturnValueOnce([`B0P${i}`]);
        mocks.htmlParser.hasNextSearchPage.mockReturnValueOnce(true);
      }

      const result = await useCase.execute();

      expect(result.asins).toEqual(['B0P0', 'B0P1', 'B0P2', 'B0P3', 'B0P4']);
      expect(mocks.httpClient.get).toHaveBeenCalledTimes(5);
    });

    it('fetches only the first page when limit is 1 regardless of pagination', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>page1</html>'));
      mocks.htmlParser.extractSearchResultAsins.mockReturnValueOnce(['B0A', 'B0B']);
      mocks.htmlParser.hasNextSearchPage.mockReturnValueOnce(true);

      const result = await useCase.execute({ limit: 1 });

      expect(result.asins).toEqual(['B0A', 'B0B']);
      expect(mocks.httpClient.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('empty page — early stop', () => {
    it('stops when extractSearchResultAsins returns empty array', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>page1</html>'))
        .mockResolvedValueOnce(ok('<html>page2</html>'));

      mocks.htmlParser.extractSearchResultAsins
        .mockReturnValueOnce(['B0A'])
        .mockReturnValueOnce([]);

      mocks.htmlParser.hasNextSearchPage.mockReturnValueOnce(true);

      const result = await useCase.execute({ limit: 5 });

      expect(result.asins).toEqual(['B0A']);
      expect(mocks.httpClient.get).toHaveBeenCalledTimes(2);
      expect(mocks.htmlParser.hasNextSearchPage).not.toHaveBeenCalledTimes(2);
    });
  });

  describe('hasNextSearchPage returns false', () => {
    it('stops after current page when no next page link exists', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get
        .mockResolvedValueOnce(ok('<html>page1</html>'))
        .mockResolvedValueOnce(ok('<html>page2</html>'));

      mocks.htmlParser.extractSearchResultAsins
        .mockReturnValueOnce(['B0A'])
        .mockReturnValueOnce(['B0B']);

      mocks.htmlParser.hasNextSearchPage
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      const result = await useCase.execute({ limit: 5 });

      expect(result.asins).toEqual(['B0A', 'B0B']);
      expect(mocks.httpClient.get).toHaveBeenCalledTimes(2);
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
        await useCase.execute();
        fail('Should have thrown');
      } catch (err) {
        const se = err as ScraperError;
        expect(se.code).toBe('blocked');
        expect(se.retryable).toBe(true);
        expect(se.suggestedCooldownMs).toBe(120_000);
        expect(se.context).toEqual(expect.objectContaining({ reason: 'CAPTCHA detected' }));
      }
      expect(mocks.htmlParser.extractSearchResultAsins).not.toHaveBeenCalled();
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
        .mockResolvedValueOnce(ok('<html>page1</html>'));

      mocks.htmlParser.extractSearchResultAsins.mockReturnValueOnce(['B0A']);
      mocks.htmlParser.hasNextSearchPage.mockReturnValueOnce(false);

      const result = await useCase.execute({ limit: 1 });

      expect(result.asins).toEqual(['B0A']);
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
        await useCase.execute();
        fail('Should have thrown');
      } catch (err) {
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
        .mockResolvedValueOnce(ok('<html>page1</html>'));

      mocks.htmlParser.extractSearchResultAsins.mockReturnValueOnce(['B0A']);
      mocks.htmlParser.hasNextSearchPage.mockReturnValueOnce(false);

      const result = await useCase.execute({ limit: 1 });

      expect(result.asins).toEqual(['B0A']);
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
        await useCase.execute();
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
        .mockResolvedValueOnce(ok('<html>page1</html>'));

      mocks.htmlParser.extractSearchResultAsins.mockReturnValueOnce(['B0A']);
      mocks.htmlParser.hasNextSearchPage.mockReturnValueOnce(false);

      const result = await useCase.execute({ limit: 1 });

      expect(result.asins).toEqual(['B0A']);
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
        await useCase.execute();
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
    it('calls onBlocked before throwing on CAPTCHA', async () => {
      const mocks = createMocks();
      const onBlocked = jest.fn().mockResolvedValue(undefined);
      const useCase = createUseCase(mocks, onBlocked);

      mocks.httpClient.get.mockResolvedValueOnce(
        ok('<html>Type the characters you see in this image</html>'),
      );

      await expect(useCase.execute()).rejects.toMatchObject({ code: 'blocked' });
      expect(onBlocked).toHaveBeenCalledTimes(1);
      expect(onBlocked).toHaveBeenCalledWith(expect.objectContaining({ code: 'blocked' }));
    });

    it('does not call onBlocked on success', async () => {
      const mocks = createMocks();
      const onBlocked = jest.fn().mockResolvedValue(undefined);
      const useCase = createUseCase(mocks, onBlocked);

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>page1</html>'));
      mocks.htmlParser.extractSearchResultAsins.mockReturnValueOnce(['B0A']);
      mocks.htmlParser.hasNextSearchPage.mockReturnValueOnce(false);

      await useCase.execute({ limit: 1 });

      expect(onBlocked).not.toHaveBeenCalled();
    });
  });

  describe('logging', () => {
    it('logs start with limit and stopAtAsin', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>page1</html>'));
      mocks.htmlParser.extractSearchResultAsins.mockReturnValueOnce(['B0A']);
      mocks.htmlParser.hasNextSearchPage.mockReturnValueOnce(false);

      await useCase.execute({ limit: 3, stopAtAsin: 'B0STOP' });

      expect(mocks.logger.info).toHaveBeenCalledWith(
        'Starting pre-sales fetch',
        expect.objectContaining({ limit: 3, stopAtAsin: 'B0STOP' }),
      );
    });

    it('logs completion with total ASINs and pages visited', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>page1</html>'));
      mocks.htmlParser.extractSearchResultAsins.mockReturnValueOnce(['B0A', 'B0B']);
      mocks.htmlParser.hasNextSearchPage.mockReturnValueOnce(false);

      await useCase.execute({ limit: 1 });

      expect(mocks.logger.info).toHaveBeenCalledWith(
        'Pre-sales fetch complete',
        expect.objectContaining({ totalAsins: 2, pagesVisited: 1 }),
      );
    });
  });

  describe('defaults', () => {
    it('uses default limit of 5 when no options provided', async () => {
      const mocks = createMocks();
      const useCase = createUseCase(mocks);

      for (let i = 0; i < 5; i++) {
        mocks.httpClient.get.mockResolvedValueOnce(ok(`<html>page${i + 1}</html>`));
        mocks.htmlParser.extractSearchResultAsins.mockReturnValueOnce([`B0P${i}`]);
        mocks.htmlParser.hasNextSearchPage.mockReturnValueOnce(true);
      }

      const result = await useCase.execute();

      expect(result.asins).toHaveLength(5);
      expect(mocks.httpClient.get).toHaveBeenCalledTimes(5);
    });
  });
});
