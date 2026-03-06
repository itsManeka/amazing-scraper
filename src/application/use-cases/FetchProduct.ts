import { ProductPage } from '../../domain/entities';
import { ScraperError } from '../../domain/errors';
import { AMAZON_BASE_URL, CAPTCHA_MARKERS } from '../../infrastructure/http/amazonConstants';
import { buildGetHeaders } from '../../infrastructure/http/buildHeaders';
import { HttpClient, HttpResponse } from '../ports/HttpClient';
import { HtmlParser } from '../ports/HtmlParser';
import { Logger } from '../ports/Logger';
import { RetryPolicy } from '../ports/RetryPolicy';
import { UserAgentProvider } from '../ports/UserAgentProvider';

/**
 * Fetches a single Amazon product page and extracts its structured data.
 * Does not follow coupon links or paginate — suitable for quick product lookups.
 */
export class FetchProduct {
  private readonly userAgent: string;

  constructor(
    private readonly httpClient: HttpClient,
    private readonly htmlParser: HtmlParser,
    private readonly logger: Logger,
    userAgentProvider: UserAgentProvider,
    private readonly retryPolicy: RetryPolicy,
    private readonly onBlocked?: (error: ScraperError) => Promise<void>,
  ) {
    this.userAgent = userAgentProvider.get();
  }

  /**
   * Fetches the product page for the given ASIN and returns extracted data.
   *
   * @throws {ScraperError} with code `"blocked"` when the request is blocked or returns a CAPTCHA.
   */
  async execute(asin: string): Promise<ProductPage> {
    const url = `${AMAZON_BASE_URL}/dp/${asin}`;
    this.logger.info('Fetching product page', { asin, url });

    const headers = buildGetHeaders(this.userAgent);
    const response = await this.fetchWithRetry(url, headers);

    await this.assertNoCaptcha(response, url);

    const page = this.htmlParser.extractProductInfo(response.data, asin, url, this.logger);
    this.logger.info('Product page fetched', {
      asin,
      title: page.title,
      hasCoupon: page.hasCoupon,
    });

    return page;
  }

  private async fetchWithRetry(url: string, headers: Record<string, string>): Promise<HttpResponse> {
    let attempt = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      let response: HttpResponse;
      try {
        response = await this.httpClient.get(url, headers);
      } catch (err) {
        const decision = this.retryPolicy.evaluate({ attempt, statusCode: 0, errorType: 'network' });
        if (decision.shouldRetry) {
          this.logger.warn('Network error, retrying', { attempt, delayMs: decision.delayMs });
          await this.delay(decision.delayMs);
          attempt++;
          continue;
        }
        const error = new ScraperError('blocked', { url, cause: String(err) }, { retryable: true, suggestedCooldownMs: 30_000 });
        await this.notifyBlocked(error);
        throw error;
      }

      if (response.status === 200) {
        return response;
      }

      if (response.status === 403 || response.status === 503) {
        const decision = this.retryPolicy.evaluate({ attempt, statusCode: response.status, errorType: 'http' });
        if (decision.shouldRetry) {
          this.logger.warn(`${response.status} on product page, retrying`, { url, attempt, delayMs: decision.delayMs });
          await this.delay(decision.delayMs);
          attempt++;
          continue;
        }

        const retryable = response.status === 503;
        const error = new ScraperError(
          'blocked',
          { url, status: response.status },
          { retryable, suggestedCooldownMs: retryable ? 30_000 : undefined },
        );
        await this.notifyBlocked(error);
        throw error;
      }

      return response;
    }
  }

  private async assertNoCaptcha(response: HttpResponse, url: string): Promise<void> {
    if (response.status === 200) {
      for (const marker of CAPTCHA_MARKERS) {
        if (response.data.includes(marker)) {
          const error = new ScraperError(
            'blocked',
            { url, reason: 'CAPTCHA detected' },
            { retryable: true, suggestedCooldownMs: 120_000 },
          );
          await this.notifyBlocked(error);
          throw error;
        }
      }
    }
  }

  private async notifyBlocked(error: ScraperError): Promise<void> {
    if (this.onBlocked) {
      try { await this.onBlocked(error); } catch { /* ignore callback errors */ }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
