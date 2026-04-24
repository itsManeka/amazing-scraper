import * as http from 'http';
import { AxiosHttpClient } from '../../src/infrastructure/http/AxiosHttpClient';
import { Logger } from '../../src/application/ports/Logger';

interface ClientInternal {
  jar: {
    getCookieStringSync: (url: string) => string;
  };
}

const logger: jest.Mocked<Logger> = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AxiosHttpClient.resetSession', () => {
  describe('Happy path', () => {
    it('clears all cookies after reset', async () => {
      const server = http.createServer((req, res) => {
        if (req.url === '/set-cookie') {
          res.setHeader('Set-Cookie', 'session-id=abc123; Path=/');
          res.writeHead(200);
          res.end('cookie set');
        }
      });

      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as { port: number }).port;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        const client = new AxiosHttpClient(logger);
        await client.get(`${baseUrl}/set-cookie`);

        // Verify cookie is present before reset
        const clientInternal = client as unknown as ClientInternal;
        let cookies = clientInternal.jar.getCookieStringSync(baseUrl);
        expect(cookies).toContain('session-id=abc123');

        // Call resetSession
        client.resetSession();

        // Verify cookies are cleared after reset
        cookies = clientInternal.jar.getCookieStringSync(baseUrl);
        expect(cookies).toBe('');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('prevents old cookies from being sent after reset', async () => {
      let secondRequestCookie = '';

      const server = http.createServer((req, res) => {
        if (req.url === '/set-cookie') {
          res.setHeader('Set-Cookie', 'session-token=xyz789; Path=/');
          res.writeHead(200);
          res.end('cookie set');
        } else if (req.url === '/check-cookie') {
          secondRequestCookie = req.headers.cookie ?? '';
          res.writeHead(200);
          res.end('ok');
        }
      });

      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as { port: number }).port;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        const client = new AxiosHttpClient(logger);

        // First request sets a cookie
        await client.get(`${baseUrl}/set-cookie`);

        // Verify cookie was received
        const clientInternal = client as unknown as ClientInternal;
        const cookies = clientInternal.jar.getCookieStringSync(baseUrl);
        expect(cookies).toContain('session-token=xyz789');

        // Reset the session
        client.resetSession();

        // Second request should not include the old cookie
        await client.get(`${baseUrl}/check-cookie`);
        expect(secondRequestCookie).toBe('');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe('Idempotency', () => {
    it('is idempotent when called twice in sequence without requests', async () => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200);
        res.end('ok');
      });

      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as { port: number }).port;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        const client = new AxiosHttpClient(logger);

        // Should not throw
        client.resetSession();
        client.resetSession();

        // Verify jar is empty
        const clientInternal = client as unknown as ClientInternal;
        const cookies = clientInternal.jar.getCookieStringSync(baseUrl);
        expect(cookies).toBe('');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('creates a new jar instance each time', async () => {
      const client = new AxiosHttpClient(logger);
      const clientInternal = client as unknown as { jar: object };

      const firstJar = clientInternal.jar;
      client.resetSession();
      const secondJar = clientInternal.jar;

      expect(firstJar).not.toBe(secondJar);
    });
  });

  describe('Session state after reset', () => {
    it('allows new requests after reset with fresh jar', async () => {
      const server = http.createServer((req, res) => {
        if (req.url === '/request1') {
          res.setHeader('Set-Cookie', 'old-cookie=value1; Path=/');
          res.writeHead(200);
          res.end('response1');
        } else if (req.url === '/request2') {
          res.setHeader('Set-Cookie', 'new-cookie=value2; Path=/');
          res.writeHead(200);
          res.end('response2');
        }
      });

      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as { port: number }).port;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        const client = new AxiosHttpClient(logger);

        // First request
        const response1 = await client.get(`${baseUrl}/request1`);
        expect(response1.status).toBe(200);
        expect(response1.data).toBe('response1');

        // Verify old cookie
        const clientInternal = client as unknown as ClientInternal;
        const cookies = clientInternal.jar.getCookieStringSync(baseUrl);
        expect(cookies).toContain('old-cookie=value1');

        // Reset
        client.resetSession();

        // Verify old cookie is gone
        const cookiesAfterReset = clientInternal.jar.getCookieStringSync(baseUrl);
        expect(cookiesAfterReset).toBe('');

        // Second request with new cookie
        const response2 = await client.get(`${baseUrl}/request2`);
        expect(response2.status).toBe(200);
        expect(response2.data).toBe('response2');

        // Verify only new cookie is present
        const cookiesAfterSecondRequest = clientInternal.jar.getCookieStringSync(baseUrl);
        expect(cookiesAfterSecondRequest).toContain('new-cookie=value2');
        expect(cookiesAfterSecondRequest).not.toContain('old-cookie');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe('Logging', () => {
    it('logs session recycle at INFO level with correct message', () => {
      const client = new AxiosHttpClient(logger);
      client.resetSession();

      expect(logger.info).toHaveBeenCalledWith('HTTP session recycled', {});
    });

    it('logs each invocation of resetSession', () => {
      const client = new AxiosHttpClient(logger);

      client.resetSession();
      expect(logger.info).toHaveBeenCalledTimes(1);

      client.resetSession();
      expect(logger.info).toHaveBeenCalledTimes(2);

      expect(logger.info).toHaveBeenCalledWith('HTTP session recycled', {});
    });
  });

  describe('Compatibility', () => {
    it('works when HttpClient.resetSession is called on a customized client without the method', () => {
      // Verify that checking for method existence works
      const customClient = {
        get: jest.fn(),
        post: jest.fn(),
        // resetSession not implemented
      } as unknown as { resetSession?: () => void };

      const resetMethod = typeof customClient.resetSession;
      expect(resetMethod).toBe('undefined');
    });
  });
});
