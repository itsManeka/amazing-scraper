import { ProductPage } from '../../domain/entities';
import { ScraperError } from '../../domain/errors';
import { HttpClient } from '../ports/HttpClient';
import { HtmlParser } from '../ports/HtmlParser';
import { Logger } from '../ports/Logger';

const AMAZON_BASE_URL = 'https://www.amazon.com.br';

const DEFAULT_HEADERS: Record<string, string> = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  'accept-language': 'pt-BR,pt;q=0.9',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

const CAPTCHA_MARKERS = [
  'Type the characters you see in this image',
  '/errors/validateCaptcha',
  '<form action="/errors/validateCaptcha"',
];

/**
 * Fetches a single Amazon product page and extracts its structured data.
 * Does not follow coupon links or paginate — suitable for quick product lookups.
 */
export class FetchProduct {
  constructor(
    private readonly httpClient: HttpClient,
    private readonly htmlParser: HtmlParser,
    private readonly logger: Logger,
  ) {}

  /**
   * Fetches the product page for the given ASIN and returns extracted data.
   *
   * @throws {ScraperError} with code `"blocked"` when the request is blocked or returns a CAPTCHA.
   */
  async execute(asin: string): Promise<ProductPage> {
    const url = `${AMAZON_BASE_URL}/dp/${asin}`;
    this.logger.info('Fetching product page', { asin, url });

    let response = await this.httpClient.get(url, DEFAULT_HEADERS);

    if (response.status === 503) {
      throw new ScraperError('blocked', { url, status: 503 });
    }

    if (response.status === 403) {
      this.logger.warn('403 on product page, retrying in 5s', { url });
      await this.delay(5000);
      response = await this.httpClient.get(url, DEFAULT_HEADERS);

      if (response.status === 403) {
        throw new ScraperError('blocked', { url, status: 403 });
      }
    }

    for (const marker of CAPTCHA_MARKERS) {
      if (response.data.includes(marker)) {
        throw new ScraperError('blocked', { url, reason: 'CAPTCHA detected' });
      }
    }

    const page = this.htmlParser.extractProductInfo(response.data, asin, url, this.logger);
    this.logger.info('Product page fetched', {
      asin,
      title: page.title,
      hasCoupon: page.hasCoupon,
    });

    return page;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
