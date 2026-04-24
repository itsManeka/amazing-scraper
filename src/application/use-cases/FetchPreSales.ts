import { FetchPreSalesResult } from '../../domain/entities';
import { ScraperError } from '../../domain/errors';
import { CAPTCHA_MARKERS, PRE_SALES_URL } from '../../infrastructure/http/amazonConstants';
import { buildGetHeaders } from '../../infrastructure/http/buildHeaders';
import { HttpClient, HttpResponse } from '../ports/HttpClient';
import { HtmlParser } from '../ports/HtmlParser';
import { Logger } from '../ports/Logger';
import { RetryPolicy } from '../ports/RetryPolicy';
import { UserAgentProvider } from '../ports/UserAgentProvider';
import { SessionRecycler } from '../services/SessionRecycler';
import { DelayConfig } from './ExtractCouponProducts';

export interface FetchPreSalesOptions {
  /** Max pages to fetch (default: 5). */
  limit?: number;
  /** Stop before collecting this ASIN — it is excluded from the result. */
  stopAtAsin?: string;
}

const DEFAULT_LIMIT = 5;

/**
 * Fetches pre-sale ASINs from the Amazon Brasil HQ & Manga search page.
 * Paginates through search results collecting ASINs until one of the
 * stop conditions is met.
 */
export class FetchPreSales {
  private readonly delayConfig: DelayConfig;

  constructor(
    private readonly httpClient: HttpClient,
    private readonly htmlParser: HtmlParser,
    private readonly logger: Logger,
    private readonly userAgentProvider: UserAgentProvider,
    private readonly retryPolicy: RetryPolicy,
    private readonly onBlocked?: (error: ScraperError) => Promise<void>,
    delayConfig?: DelayConfig,
    private readonly sessionRecycler?: SessionRecycler,
  ) {
    this.delayConfig = delayConfig ?? { min: 1000, max: 2000 };
  }

  /**
   * Fetches pre-sale ASINs from the Amazon search page.
   *
   * @param options - Optional limit (page count) and stop-ASIN sentinel.
   * @returns An object containing the collected ASINs.
   */
  async execute(options?: FetchPreSalesOptions): Promise<FetchPreSalesResult> {
    const limit = options?.limit ?? DEFAULT_LIMIT;
    const stopAtAsin = options?.stopAtAsin;

    this.logger.info('Starting pre-sales fetch', { limit, stopAtAsin });

    const collectedAsins: string[] = [];
    let page = 0;

    while (page < limit) {
      page++;

      const url = page === 1 ? PRE_SALES_URL : `${PRE_SALES_URL}&page=${page}`;
      this.logger.info('Fetching search page', { page, url });

      const userAgent = this.userAgentProvider.get();
      const headers = buildGetHeaders(userAgent);
      const response = await this.fetchWithRetry(url, headers);
      await this.assertNoCaptcha(response, url);

      // Record the request for preventive session recycling
      this.sessionRecycler?.recordRequest();

      const asins = this.htmlParser.extractSearchResultAsins(response.data);

      if (asins.length === 0) {
        this.logger.info('Empty page, stopping', { page });
        break;
      }

      if (stopAtAsin) {
        const sentinelIndex = asins.indexOf(stopAtAsin);
        if (sentinelIndex !== -1) {
          const before = asins.slice(0, sentinelIndex);
          collectedAsins.push(...before);
          this.logger.info('Stop ASIN found, stopping', { page, stopAtAsin, collectedBefore: before.length });
          break;
        }
      }

      collectedAsins.push(...asins);

      if (!this.htmlParser.hasNextSearchPage(response.data)) {
        this.logger.info('No next page, stopping', { page });
        break;
      }

      if (page < limit) {
        await this.randomDelay();
      }
    }

    this.logger.info('Pre-sales fetch complete', { totalAsins: collectedAsins.length, pagesVisited: page });

    return { asins: collectedAsins };
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
          this.logger.warn(`${response.status} on search page, retrying`, { url, attempt, delayMs: decision.delayMs });
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

  private randomDelay(): Promise<void> {
    const ms = Math.floor(Math.random() * (this.delayConfig.max - this.delayConfig.min + 1)) + this.delayConfig.min;
    return this.delay(ms);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
