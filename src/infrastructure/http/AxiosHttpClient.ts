import axios, { AxiosInstance } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { HttpClient, HttpGetOptions, HttpResponse } from '../../application/ports/HttpClient';
import { Logger } from '../../application/ports/Logger';
import * as querystring from 'querystring';

const SENSITIVE_COOKIE_NAMES = ['at-acbbr', 'session-token', 'sst-acbbr'];

/**
 * Axios-based HTTP client with automatic cookie-jar session management.
 * Sensitive cookies are never logged.
 */
export class AxiosHttpClient implements HttpClient {
  private client: AxiosInstance;
  private jar: CookieJar;

  constructor(private readonly logger: Logger) {
    this.jar = new CookieJar();
    this.client = wrapper(
      axios.create({
        jar: this.jar,
        withCredentials: true,
        maxRedirects: 5,
        validateStatus: () => true,
        responseType: 'text',
        transformResponse: [(data: string): string => data],
      }),
    );
  }

  async get(
    url: string,
    headers?: Record<string, string>,
    options?: HttpGetOptions,
  ): Promise<HttpResponse> {
    this.logger.info('HTTP GET', { url });

    const requestConfig: Record<string, unknown> = { headers };

    // Defense-in-depth against SSRF via cross-host redirects:
    // when an allowlist is provided, any redirect whose target hostname is
    // not listed causes the underlying Axios follow-redirects call to throw.
    if (options?.allowedRedirectHosts && options.allowedRedirectHosts.length > 0) {
      const allowed = new Set(options.allowedRedirectHosts);
      requestConfig.beforeRedirect = (
        redirectOptions: { hostname?: string; host?: string },
      ): void => {
        const hostname = redirectOptions.hostname ?? redirectOptions.host;
        if (!hostname || !allowed.has(hostname)) {
          throw new Error(
            `Redirect to disallowed host: ${hostname ?? '<unknown>'}`,
          );
        }
      };
    }

    const response = await this.client.get<string>(url, requestConfig);
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

  resetSession(): void {
    this.jar = new CookieJar();
    this.client = wrapper(
      axios.create({
        jar: this.jar,
        withCredentials: true,
        maxRedirects: 5,
        validateStatus: () => true,
        responseType: 'text',
        transformResponse: [(data: string): string => data],
      }),
    );
    this.logger.info('HTTP session recycled', {});
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
