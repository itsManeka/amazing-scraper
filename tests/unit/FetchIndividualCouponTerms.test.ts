import * as fs from 'fs';
import * as path from 'path';
import nock from 'nock';
import { FetchIndividualCouponTerms } from '../../src/application/use-cases/FetchIndividualCouponTerms';
import { AxiosHttpClient } from '../../src/infrastructure/http/AxiosHttpClient';
import { CheerioHtmlParser } from '../../src/infrastructure/parsers/CheerioHtmlParser';
import { HttpClient, HttpResponse } from '../../src/application/ports/HttpClient';
import { HtmlParser } from '../../src/application/ports/HtmlParser';
import { Logger } from '../../src/application/ports/Logger';
import { UserAgentProvider } from '../../src/application/ports/UserAgentProvider';

const AMAZON_BASE = 'https://www.amazon.com.br';
const TERMS_PATH = '/promotion/details/popup/ATVO4IBO0PTIE';
const TERMS_QS = '?ref=cxcw_bxgx_tc_ATVO4IBO0PTIE&source=dp_cxcw';
const TERMS_URL = `${TERMS_PATH}${TERMS_QS}`;
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

  return { httpClient, htmlParser, logger, userAgentProvider };
}

describe('FetchIndividualCouponTerms', () => {
  describe('with mocked dependencies', () => {
    it('returns null when termsUrl hostname is not www.amazon.com.br (SSRF guard)', async () => {
      const mocks = createMocks();
      const useCase = new FetchIndividualCouponTerms(
        mocks.httpClient,
        mocks.htmlParser,
        mocks.logger,
        mocks.userAgentProvider,
      );

      const result = await useCase.execute('https://evil.com/promotion/details/popup/XYZ');

      expect(result).toBeNull();
      expect(mocks.httpClient.get).not.toHaveBeenCalled();
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('unexpected host'),
        expect.objectContaining({ termsUrl: 'https://evil.com/promotion/details/popup/XYZ' }),
      );
    });

    it('returns null for a malformed termsUrl', async () => {
      const mocks = createMocks();
      const useCase = new FetchIndividualCouponTerms(
        mocks.httpClient,
        mocks.htmlParser,
        mocks.logger,
        mocks.userAgentProvider,
      );

      const result = await useCase.execute('not a url');

      expect(result).toBeNull();
      expect(mocks.httpClient.get).not.toHaveBeenCalled();
    });

    it('returns null when termsUrl is empty', async () => {
      const mocks = createMocks();
      const useCase = new FetchIndividualCouponTerms(
        mocks.httpClient,
        mocks.htmlParser,
        mocks.logger,
        mocks.userAgentProvider,
      );

      expect(await useCase.execute('')).toBeNull();
      expect(mocks.httpClient.get).not.toHaveBeenCalled();
    });

    it('prefixes relative termsUrl with https://www.amazon.com.br before fetching', async () => {
      const mocks = createMocks();
      const useCase = new FetchIndividualCouponTerms(
        mocks.httpClient,
        mocks.htmlParser,
        mocks.logger,
        mocks.userAgentProvider,
      );

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>x</html>'));
      mocks.htmlParser.extractIndividualCouponTerms.mockReturnValue('rules text');

      const result = await useCase.execute(TERMS_URL);

      expect(result).toBe('rules text');
      expect(mocks.httpClient.get).toHaveBeenCalledTimes(1);
      const [calledUrl, headers] = mocks.httpClient.get.mock.calls[0];
      expect(calledUrl.startsWith(`${AMAZON_BASE}${TERMS_PATH}`)).toBe(true);
      expect(headers).toEqual(expect.objectContaining({ 'user-agent': TEST_UA }));
    });

    it('returns null when http client throws (network failure)', async () => {
      const mocks = createMocks();
      const useCase = new FetchIndividualCouponTerms(
        mocks.httpClient,
        mocks.htmlParser,
        mocks.logger,
        mocks.userAgentProvider,
      );

      mocks.httpClient.get.mockRejectedValueOnce(new Error('ECONNRESET'));

      const result = await useCase.execute(TERMS_URL);

      expect(result).toBeNull();
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Network failure'),
        expect.objectContaining({ error: expect.stringContaining('ECONNRESET') }),
      );
    });

    it('returns null when endpoint responds with non-200 status', async () => {
      const mocks = createMocks();
      const useCase = new FetchIndividualCouponTerms(
        mocks.httpClient,
        mocks.htmlParser,
        mocks.logger,
        mocks.userAgentProvider,
      );

      mocks.httpClient.get.mockResolvedValueOnce({ status: 500, data: 'server error' });

      const result = await useCase.execute(TERMS_URL);

      expect(result).toBeNull();
      expect(mocks.htmlParser.extractIndividualCouponTerms).not.toHaveBeenCalled();
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('non-200'),
        expect.objectContaining({ status: 500 }),
      );
    });

    it('returns null when parser does not find terms content', async () => {
      const mocks = createMocks();
      const useCase = new FetchIndividualCouponTerms(
        mocks.httpClient,
        mocks.htmlParser,
        mocks.logger,
        mocks.userAgentProvider,
      );

      mocks.httpClient.get.mockResolvedValueOnce(ok('<html>no rules here</html>'));
      mocks.htmlParser.extractIndividualCouponTerms.mockReturnValue(null);

      const result = await useCase.execute(TERMS_URL);

      expect(result).toBeNull();
    });
  });

  describe('with real CheerioHtmlParser and nock (endpoint fragment fixture)', () => {
    let fragment: string;
    let lampadaFragment: string;

    beforeAll(() => {
      const fixturesDir = path.join(__dirname, '..', 'fixtures');
      fragment = fs.readFileSync(
        path.join(fixturesDir, 'terms-popup-fragment.html'),
        'utf-8',
      );
      lampadaFragment = fs.readFileSync(
        path.join(fixturesDir, 'terms-popup-lampada.html'),
        'utf-8',
      );
    });

    beforeEach(() => {
      nock.cleanAll();
    });

    afterAll(() => {
      nock.restore();
    });

    function createRealUseCase() {
      const logger: jest.Mocked<Logger> = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };
      const userAgentProvider: jest.Mocked<UserAgentProvider> = {
        get: jest.fn().mockReturnValue(TEST_UA),
      };
      const httpClient = new AxiosHttpClient(logger);
      const htmlParser = new CheerioHtmlParser();
      const useCase = new FetchIndividualCouponTerms(
        httpClient,
        htmlParser,
        logger,
        userAgentProvider,
      );
      return { useCase, logger };
    }

    it('F21: returns non-null terms string when endpoint serves the lampada popover fragment', async () => {
      nock(AMAZON_BASE)
        .get(TERMS_PATH)
        .query(true)
        .reply(200, lampadaFragment);

      const { useCase } = createRealUseCase();
      const result = await useCase.execute(TERMS_URL);

      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
      expect(result!.length).toBeGreaterThan(100);
      expect(result).not.toContain('\u00a0');
      expect(result!.startsWith('* Promoção válida exclusivamente')).toBe(true);
    });

    it('returns non-empty string containing "Válido até" when endpoint serves the fragment', async () => {
      nock(AMAZON_BASE)
        .get(TERMS_PATH)
        .query(true)
        .reply(200, fragment);

      const { useCase } = createRealUseCase();
      const result = await useCase.execute(TERMS_URL);

      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThan(0);
      expect(result).toContain('Válido até');
    });

    it('normalises non-breaking spaces (\\u00a0) to regular spaces', async () => {
      nock(AMAZON_BASE)
        .get(TERMS_PATH)
        .query(true)
        .reply(200, fragment);

      const { useCase } = createRealUseCase();
      const result = await useCase.execute(TERMS_URL);

      expect(result).not.toBeNull();
      // The fixture contains `R$&nbsp;80` — after normalisation it must be `R$ 80`
      expect(result).toContain('R$ 80');
      expect(result).not.toContain('\u00a0');
    });

    it('returns null when endpoint responds 500', async () => {
      nock(AMAZON_BASE)
        .get(TERMS_PATH)
        .query(true)
        .reply(500, 'boom');

      const { useCase } = createRealUseCase();
      const result = await useCase.execute(TERMS_URL);

      expect(result).toBeNull();
    });

    it('rejects cross-host termsUrl without contacting the network', async () => {
      // Register a nock scope to ensure no request is made anywhere
      const evilScope = nock('https://evil.com').get(/.*/).reply(200, 'pwned');

      const { useCase } = createRealUseCase();
      const result = await useCase.execute('https://evil.com/promotion/details/popup/ATVO4IBO0PTIE');

      expect(result).toBeNull();
      expect(evilScope.isDone()).toBe(false);
      nock.cleanAll();
    });

    it('follows a same-host redirect (amazon.com.br -> amazon.com.br) and returns the terms', async () => {
      const REDIRECT_PATH = '/promotion/details/redirect/ATVO4IBO0PTIE';

      // Initial endpoint responds with a 301 pointing to the real popup path
      // on the same host; the popup path then returns the HTML fragment.
      nock(AMAZON_BASE)
        .get(REDIRECT_PATH)
        .query(true)
        .reply(301, '', { Location: `${AMAZON_BASE}${TERMS_PATH}${TERMS_QS}` });

      nock(AMAZON_BASE)
        .get(TERMS_PATH)
        .query(true)
        .reply(200, fragment);

      const { useCase } = createRealUseCase();
      const result = await useCase.execute(`${REDIRECT_PATH}?ref=cxcw_bxgx_tc_ATVO4IBO0PTIE`);

      expect(result).not.toBeNull();
      expect(result).toContain('Válido até');
    });

    it('blocks a cross-host redirect (amazon.com.br -> evil.com) and returns null without reaching the destination', async () => {
      // The amazon endpoint responds with a 302 pointing to evil.com.
      nock(AMAZON_BASE)
        .get(TERMS_PATH)
        .query(true)
        .reply(302, '', { Location: 'https://evil.com/pwned' });

      // Register the evil host so we can assert it is NEVER contacted.
      const evilScope = nock('https://evil.com').get('/pwned').reply(200, 'pwned');

      const { useCase, logger } = createRealUseCase();
      const result = await useCase.execute(TERMS_URL);

      expect(result).toBeNull();
      expect(evilScope.isDone()).toBe(false);
      // The failure must surface through the network-failure warn path (the
      // beforeRedirect throws), not the non-200 path.
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Network failure'),
        expect.objectContaining({ error: expect.stringContaining('disallowed host') }),
      );
      nock.cleanAll();
    });
  });
});
