import { CouponInfo, CouponMetadata, IndividualCouponInfo, ProductPage } from '../../domain/entities';
import { Logger } from './Logger';

/**
 * Port for parsing Amazon HTML pages.
 */
export interface HtmlParser {
  /**
   * Extracts coupon promotion data from a product detail page.
   * Returns `null` when no coupon link is found.
   */
  extractCouponInfo(html: string): CouponInfo | null;

  /**
   * Extracts inline "individual" coupon data from a product detail page.
   * An individual coupon appears inside `#promoPriceBlockMessage_feature_div`
   * with a `PromotionsDiscovery` owner and no `/promotion/psp/` link —
   * typical of promotions whose terms are served via an AJAX popover.
   * Returns `null` when no individual coupon is found. PSP-style coupons
   * take precedence: callers should only consider the individual coupon
   * when `extractCouponInfo` returned `null`.
   */
  extractIndividualCouponInfo(html: string): IndividualCouponInfo | null;

  /**
   * Extracts the terms text from the HTML fragment returned by the
   * individual coupon popover endpoint (`/promotion/details/popup/{ID}`).
   * The fragment contains a `[id^="promo_tnc_content_"]` element whose
   * text holds the human-readable rules. The returned text is normalised
   * (non-breaking spaces replaced and trimmed). Returns `null` when the
   * selector is absent or yields only empty text.
   */
  extractIndividualCouponTerms(html: string): string | null;

  /**
   * Extracts the anti-CSRF token from a coupon promotion page.
   * Returns `null` when no token is found.
   */
  extractCsrfToken(html: string): string | null;

  /**
   * Extracts coupon metadata (title, description, expiration) from a coupon promotion page.
   * Always returns a `CouponMetadata` object; absent fields are `null`.
   */
  extractCouponMetadata(html: string): CouponMetadata;

  /**
   * Extracts structured product data from a product detail page.
   * @param html - Raw HTML of the product page
   * @param asin - The ASIN used to fetch the page
   * @param url - The canonical URL of the page
   * @param logger - Optional logger for emitting warnings on unrecognized availability text
   */
  extractProductInfo(html: string, asin: string, url: string, logger?: Logger): ProductPage;

  /**
   * Extracts ASINs from an Amazon search results page.
   * Returns an ordered array of non-empty ASIN strings.
   */
  extractSearchResultAsins(html: string): string[];

  /**
   * Checks whether the search results page has a next page link.
   */
  hasNextSearchPage(html: string): boolean;
}
