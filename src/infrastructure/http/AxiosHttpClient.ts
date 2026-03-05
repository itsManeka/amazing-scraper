import axios, { AxiosInstance, AxiosError } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { HttpClient, HttpResponse } from '../../application/ports/HttpClient';
import { Logger } from '../../application/ports/Logger';
import * as querystring from 'querystring';

const SENSITIVE_COOKIE_NAMES = ['at-acbbr', 'session-token', 'sst-acbbr'];

/**
 * Axios-based HTTP client with automatic cookie-jar session management.
 * Sensitive cookies are never logged.
 */
export class AxiosHttpClient implements HttpClient {
  private readonly client: AxiosInstance;
  private readonly jar: CookieJar;

  constructor(private readonly logger: Logger) {
    this.jar = new CookieJar();
    this.client = wrapper(
      axios.create({
        jar: this.jar,
        withCredentials: true,
        maxRedirects: 5,
        validateStatus: () => true,
        responseType: 'text',
        transformResponse: [(data: string) => data],
      }),
    );
  }

  async get(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
    this.logger.info('HTTP GET', { url });

    const response = await this.client.get<string>(url, { headers });
    this.logSafeCookies(url);
    return { status: response.status, data: response.data };
  }

  async post(
    url: string,
    data: Record<string, unknown>,
    options: { formEncoded: boolean },
    headers?: Record<string, string>,
  ): Promise<HttpResponse> {
    this.logger.info('HTTP POST', { url, formEncoded: options.formEncoded });

    const body = options.formEncoded ? querystring.stringify(data as Record<string, string>) : data;
    const contentType = options.formEncoded
      ? 'application/x-www-form-urlencoded; charset=UTF-8'
      : 'application/json';

    const response = await this.client.post<string>(url, body, {
      headers: { 'content-type': contentType, ...headers },
    });
    this.logSafeCookies(url);
    return { status: response.status, data: response.data };
  }

  private logSafeCookies(url: string): void {
    try {
      const cookies = this.jar.getCookieStringSync(url);
      const safeCookies = cookies
        .split('; ')
        .filter((c) => {
          const name = c.split('=')[0];
          return !SENSITIVE_COOKIE_NAMES.includes(name);
        })
        .join('; ');

      if (safeCookies) {
        this.logger.info('Session cookies (non-sensitive)', { cookies: safeCookies });
      }
    } catch {
      // Cookie retrieval failures are non-critical
    }
  }
}
