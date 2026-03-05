import nock from 'nock';
import { AxiosHttpClient } from '../../src/infrastructure/http/AxiosHttpClient';
import { Logger } from '../../src/application/ports/Logger';

const TEST_BASE = 'http://test.example.com';

const logger: jest.Mocked<Logger> = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  nock.cleanAll();
});

afterAll(() => {
  nock.restore();
});

describe('AxiosHttpClient', () => {
  describe('GET requests', () => {
    it('returns status and body', async () => {
      nock(TEST_BASE)
        .get('/page')
        .reply(200, '<html>Hello</html>');

      const client = new AxiosHttpClient(logger);
      const response = await client.get(`${TEST_BASE}/page`);

      expect(response.status).toBe(200);
      expect(response.data).toContain('Hello');
    });

    it('forwards custom headers', async () => {
      let receivedHeaders: Record<string, string | string[] | undefined> = {};

      nock(TEST_BASE)
        .get('/headers')
        .reply(function () {
          receivedHeaders = this.req.headers;
          return [200, 'ok'];
        });

      const client = new AxiosHttpClient(logger);
      await client.get(`${TEST_BASE}/headers`, {
        'x-custom-header': 'test-value',
        'accept-language': 'pt-BR',
      });

      expect(receivedHeaders['x-custom-header']).toContain('test-value');
      expect(receivedHeaders['accept-language']).toContain('pt-BR');
    });

    it('returns non-2xx status without throwing', async () => {
      nock(TEST_BASE)
        .get('/forbidden')
        .reply(403, 'Forbidden');

      const client = new AxiosHttpClient(logger);
      const response = await client.get(`${TEST_BASE}/forbidden`);

      expect(response.status).toBe(403);
      expect(response.data).toBe('Forbidden');
    });
  });

  describe('POST requests', () => {
    it('sends form-encoded body when formEncoded is true', async () => {
      let receivedBody = '';
      let receivedContentType = '';

      nock(TEST_BASE)
        .post('/form')
        .reply(function (_uri, body) {
          receivedContentType = String(this.req.headers['content-type'] ?? '');
          receivedBody = typeof body === 'string' ? body : JSON.stringify(body);
          return [200, '{"success":true}'];
        });

      const client = new AxiosHttpClient(logger);
      await client.post(
        `${TEST_BASE}/form`,
        { key1: 'value1', key2: 'value2' },
        { formEncoded: true },
      );

      expect(receivedContentType).toContain('application/x-www-form-urlencoded');
      expect(receivedBody).toContain('key1=value1');
      expect(receivedBody).toContain('key2=value2');
    });

    it('sends JSON body when formEncoded is false', async () => {
      let receivedBody = '';
      let receivedContentType = '';

      nock(TEST_BASE)
        .post('/json')
        .reply(function (_uri, body) {
          receivedContentType = String(this.req.headers['content-type'] ?? '');
          receivedBody = typeof body === 'string' ? body : JSON.stringify(body);
          return [200, '{"success":true}'];
        });

      const client = new AxiosHttpClient(logger);
      await client.post(
        `${TEST_BASE}/json`,
        { key1: 'value1' },
        { formEncoded: false },
      );

      expect(receivedContentType).toContain('application/json');
      expect(JSON.parse(receivedBody)).toEqual({ key1: 'value1' });
    });

    it('forwards custom headers on POST', async () => {
      let receivedXhr = '';

      nock(TEST_BASE)
        .post('/xhr')
        .reply(function () {
          receivedXhr = String(this.req.headers['x-requested-with'] ?? '');
          return [200, '{"ok":true}'];
        });

      const client = new AxiosHttpClient(logger);
      await client.post(
        `${TEST_BASE}/xhr`,
        { data: 'test' },
        { formEncoded: true },
        { 'x-requested-with': 'XMLHttpRequest' },
      );

      expect(receivedXhr).toBe('XMLHttpRequest');
    });
  });

  describe('error propagation', () => {
    it('GET propagates network errors', async () => {
      nock(TEST_BASE)
        .get('/network-error')
        .replyWithError('ECONNRESET');

      const client = new AxiosHttpClient(logger);
      await expect(client.get(`${TEST_BASE}/network-error`)).rejects.toThrow();
    });

    it('POST propagates network errors', async () => {
      nock(TEST_BASE)
        .post('/network-error')
        .replyWithError('ECONNREFUSED');

      const client = new AxiosHttpClient(logger);
      await expect(
        client.post(`${TEST_BASE}/network-error`, { x: '1' }, { formEncoded: true }),
      ).rejects.toThrow();
    });
  });

  describe('logging', () => {
    it('logs HTTP method and URL for GET', async () => {
      nock(TEST_BASE)
        .get('/log-test')
        .reply(200, 'ok');

      const client = new AxiosHttpClient(logger);
      await client.get(`${TEST_BASE}/log-test`);

      expect(logger.info).toHaveBeenCalledWith('HTTP GET', { url: `${TEST_BASE}/log-test` });
    });

    it('logs HTTP method and URL for POST', async () => {
      nock(TEST_BASE)
        .post('/log-post')
        .reply(200, 'ok');

      const client = new AxiosHttpClient(logger);
      await client.post(`${TEST_BASE}/log-post`, { x: '1' }, { formEncoded: true });

      expect(logger.info).toHaveBeenCalledWith('HTTP POST', {
        url: `${TEST_BASE}/log-post`,
        formEncoded: true,
      });
    });
  });
});
