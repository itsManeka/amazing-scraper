import * as http from 'http';
import { AxiosHttpClient } from '../../src/infrastructure/http/AxiosHttpClient';
import { Logger } from '../../src/application/ports/Logger';

const logger: jest.Mocked<Logger> = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

describe('AxiosHttpClient — cookie session', () => {
  it('preserves cookies across sequential requests', async () => {
    let secondRequestCookie = '';

    const server = http.createServer((req, res) => {
      if (req.url === '/set-cookie') {
        res.setHeader('Set-Cookie', 'session-id=abc123; Path=/');
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
    const base = `http://127.0.0.1:${port}`;

    try {
      const client = new AxiosHttpClient(logger);
      await client.get(`${base}/set-cookie`);
      await client.get(`${base}/check-cookie`);

      expect(secondRequestCookie).toContain('session-id=abc123');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('does not share cookies between different client instances', async () => {
    let secondClientCookie = '';

    const server = http.createServer((req, res) => {
      if (req.url === '/set-cookie') {
        res.setHeader('Set-Cookie', 'private=secret; Path=/');
        res.writeHead(200);
        res.end('cookie set');
      } else if (req.url === '/check-cookie') {
        secondClientCookie = req.headers.cookie ?? '';
        res.writeHead(200);
        res.end('ok');
      }
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;

    try {
      const client1 = new AxiosHttpClient(logger);
      const client2 = new AxiosHttpClient(logger);

      await client1.get(`${base}/set-cookie`);
      await client2.get(`${base}/check-cookie`);

      expect(secondClientCookie).toBe('');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
