import { AMAZON_BASE_URL } from '../../infrastructure/http/amazonConstants';
import { buildGetHeaders } from '../../infrastructure/http/buildHeaders';
import { HttpClient } from '../ports/HttpClient';
import { HtmlParser } from '../ports/HtmlParser';
import { Logger } from '../ports/Logger';
import { UserAgentProvider } from '../ports/UserAgentProvider';

const AMAZON_HOSTNAME = 'www.amazon.com.br';

/**
 * Fetches the terms text of an inline "individual" coupon from the Amazon
 * popover endpoint (`/promotion/details/popup/{PROMOTION_ID}`).
 *
 * The input `termsUrl` comes from the `data-a-modal` JSON attribute in the
 * product HTML and is either relative (starts with `/`) or absolute. To
 * mitigate SSRF, the resolved hostname is pinned to `www.amazon.com.br` —
 * any other host yields `null` without issuing the request. As
 * defense-in-depth, the underlying HTTP client is explicitly told to reject
 * any redirect whose target hostname is not `www.amazon.com.br` via the
 * `allowedRedirectHosts` option; a cross-host redirect therefore yields
 * `null` without ever contacting the foreign host.
 *
 * On network failure, non-2xx responses, or when the terms selector is
 * absent, the method returns `null` instead of throwing: the `terms_text`
 * field downstream is optional and a missing value is acceptable.
 */
export class FetchIndividualCouponTerms {
  constructor(
    private readonly httpClient: HttpClient,
    private readonly htmlParser: HtmlParser,
    private readonly logger: Logger,
    private readonly userAgentProvider: UserAgentProvider,
  ) {}

  async execute(termsUrl: string): Promise<string | null> {
    const fullUrl = this.resolveAndValidateUrl(termsUrl);
    if (!fullUrl) {
      this.logger.warn('Rejected individual coupon terms URL — unexpected host', { termsUrl });
      return null;
    }

    try {
      const userAgent = this.userAgentProvider.get();
      const response = await this.httpClient.get(
        fullUrl,
        buildGetHeaders(userAgent),
        { allowedRedirectHosts: [AMAZON_HOSTNAME] },
      );
      if (response.status !== 200) {
        this.logger.warn('Individual coupon terms endpoint returned non-200', {
          url: fullUrl,
          status: response.status,
        });
        return null;
      }
      return this.htmlParser.extractIndividualCouponTerms(response.data);
    } catch (err) {
      this.logger.warn('Network failure while fetching individual coupon terms', {
        url: fullUrl,
        error: String(err),
      });
      return null;
    }
  }

  /**
   * Builds the absolute URL from a `termsUrl` that may be relative or absolute
   * and enforces that the resolved hostname is `www.amazon.com.br`. Returns
   * `null` when the URL is invalid or resolves to a different host.
   */
  private resolveAndValidateUrl(termsUrl: string): string | null {
    if (!termsUrl || typeof termsUrl !== 'string') return null;

    let parsed: URL;
    try {
      parsed = termsUrl.startsWith('/')
        ? new URL(termsUrl, AMAZON_BASE_URL)
        : new URL(termsUrl);
    } catch {
      return null;
    }

    if (parsed.hostname !== AMAZON_HOSTNAME) return null;
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

    return parsed.toString();
  }
}
