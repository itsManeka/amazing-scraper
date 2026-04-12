import * as cheerio from 'cheerio';
import { HtmlParser } from '../../application/ports/HtmlParser';
import { Logger } from '../../application/ports/Logger';
import { CouponInfo, CouponMetadata, ProductPage } from '../../domain/entities';

/**
 * Normalises an Amazon product image URL to the `._SL500_` size suffix.
 *
 * - URLs that already contain a dimension suffix (`._SX\d+_`, `._SY\d+_`, `._SL\d+_`,
 *   `._AC_\w+_`) have that suffix replaced by `._SL500_`.
 * - URLs that end with `V1_.jpg` (no dimension suffix) get `._SL500_` inserted before `.jpg`.
 * - All other URLs are returned unchanged.
 */
export function normalizeAmazonImageUrl(url: string): string {
  // Replace existing dimension suffix with ._SL500_
  const withSuffix = url.replace(
    /\._(?:SX\d+|SY\d+|SL\d+|AC(?:_\w+)?)_\./,
    '._SL500_.',
  );
  if (withSuffix !== url) {
    return withSuffix;
  }

  // Insert ._SL500_ before .jpg when the URL ends with V1_.jpg (no suffix present)
  if (/V1_\.jpg$/i.test(url)) {
    return url.replace(/\.jpg$/i, '._SL500_.jpg');
  }

  return url;
}

/** Maps raw `productGroupID` values to PA API-style `ProductGroup.DisplayValue` labels. */
const PRODUCT_GROUP_LABELS: Record<string, string> = {
  book_display_on_website: 'Book',
  ce_display_on_website: 'Consumer Electronics',
  dvd_display_on_website: 'DVD',
  toy_display_on_website: 'Toy',
  kitchen_display_on_website: 'Kitchen',
  video_games_display_on_website: 'Video Games',
  wireless_display_on_website: 'Wireless',
  baby_product_display_on_website: 'Baby Product',
  shoes_display_on_website: 'Shoes',
  apparel_display_on_website: 'Apparel',
  beauty_display_on_website: 'Beauty',
  grocery_display_on_website: 'Grocery',
  pet_products_display_on_website: 'Pet Products',
  office_products_display_on_website: 'Office Product',
  sports_display_on_website: 'Sports',
  automotive_display_on_website: 'Automotive',
  home_display_on_website: 'Home',
  home_improvement_display_on_website: 'Home Improvement',
  digital_ebook_purchase_display_on_website: 'Digital Ebook Purchase',
  software_display_on_website: 'Software',
  musical_instruments_display_on_website: 'Musical Instruments',
  audible_display_on_website: 'Audible',
};

/**
 * Cheerio-based parser for extracting coupon data and CSRF tokens from Amazon HTML.
 */
export class CheerioHtmlParser implements HtmlParser {
  /**
   * Extracts coupon promotion info from a product page.
   * Tries 3 patterns in order:
   * 1. Anchor tags with `/promotion/psp/` in href
   * 2. Elements with id containing "coupon" that wrap an anchor
   * 3. Anchor tags with text containing "cupom", "coupon", or "Clique para aplicar"
   */
  extractCouponInfo(html: string): CouponInfo | null {
    const $ = cheerio.load(html);

    let couponHref: string | null = null;

    // Pattern 1: <a href="/promotion/psp/...">
    $('a[href*="/promotion/psp/"]').each((_, el) => {
      if (!couponHref) {
        couponHref = $(el).attr('href') ?? null;
      }
    });

    // Pattern 2: elements with id containing "coupon" → find child anchor
    if (!couponHref) {
      $('[id*="coupon"] a, [id*="Coupon"] a').each((_, el) => {
        if (!couponHref) {
          const href = $(el).attr('href') ?? '';
          if (href.includes('/promotion/psp/')) {
            couponHref = href;
          }
        }
      });
    }

    // Pattern 3: anchor text containing coupon keywords
    if (!couponHref) {
      $('a').each((_, el) => {
        if (!couponHref) {
          const text = $(el).text().toLowerCase();
          if (
            text.includes('cupom') ||
            text.includes('coupon') ||
            text.includes('clique para aplicar')
          ) {
            const href = $(el).attr('href') ?? '';
            if (href.includes('/promotion/psp/')) {
              couponHref = href;
            }
          }
        }
      });
    }

    if (!couponHref) {
      return null;
    }

    const couponCode = this.extractCouponCode($);
    const info = this.parseCouponHref(couponHref);
    if (info) {
      info.couponCode = couponCode;
    }
    return info;
  }

  /**
   * Extracts anti-csrftoken-a2z from a coupon page.
   * Strategies in priority order:
   * 1. Token inside `productInfoListParam` block (the one used for the AJAX POST)
   * 2. `<input type="hidden" name="anti-csrftoken-a2z" value="...">`
   * 3. `"anti-csrftoken-a2z" : "..."` or `'...'` (first JS match)
   * 4. `anti-csrftoken-a2z = "..."` or `'...'`
   */
  extractCsrfToken(html: string): string | null {
    const $ = cheerio.load(html);

    // Strategy 1: token inside productInfoListParam (exact context for the POST endpoint)
    const pspParamBlock = html.match(
      /productInfoListParam\s*=\s*\{[\s\S]*?["']anti-csrftoken-a2z["']\s*:\s*['"]([^'"]+)['"]/,
    );
    if (pspParamBlock?.[1]) {
      return pspParamBlock[1];
    }

    // Strategy 2: hidden input
    const inputVal = $('input[name="anti-csrftoken-a2z"]').attr('value');
    if (inputVal) {
      return inputVal;
    }

    // Strategy 3: JSON/JS assignment (single or double quotes)
    const jsonMatch = html.match(/["']anti-csrftoken-a2z["']\s*:\s*['"]([^'"]+)['"]/);
    if (jsonMatch?.[1]) {
      return jsonMatch[1];
    }

    // Strategy 4: JS-like assignment
    const jsMatch = html.match(/anti-csrftoken-a2z\s*=\s*['"]([^'"]+)['"]/);
    if (jsMatch?.[1]) {
      return jsMatch[1];
    }

    return null;
  }

  /**
   * Extracts coupon metadata (title, description, expiration) from a coupon promotion page.
   * Selectors target the Amazon PSP (Promotion Shopping Page) layout.
   */
  extractCouponMetadata(html: string): CouponMetadata {
    const $ = cheerio.load(html);

    const title = this.extractCouponTitle($);
    const description = this.extractCouponDescription($);
    const expiresAt = this.extractCouponExpiration($);

    return { title, description, expiresAt };
  }

  /**
   * Normalises text extracted from Amazon HTML: replaces non-breaking spaces
   * (`\u00a0` / `&nbsp;`) with regular spaces and trims. This is required
   * because JS `\s` does not match `\u00a0`, so regexes like `até\s+` would
   * fail silently when Amazon inserts non-breaking spaces.
   */
  private normalizeText(text: string): string {
    return text.replace(/\u00a0/g, ' ').trim();
  }

  private extractCouponTitle($: cheerio.CheerioAPI): string | null {
    const selectors = [
      '#promotionTitle h1',
      '#promotionTitle',
    ];

    for (const sel of selectors) {
      const text = this.normalizeText($(sel).text());
      if (text) return text;
    }

    return null;
  }

  private extractCouponDescription($: cheerio.CheerioAPI): string | null {
    const text = this.normalizeText($('#promotionSchedule').text());
    return text || null;
  }

  private extractCouponExpiration($: cheerio.CheerioAPI): string | null {
    const rawText = this.normalizeText($('#promotionSchedule').text());
    if (!rawText) return null;
    return this.parseExpirationText(rawText);
  }

  private static readonly MONTH_MAP: Record<string, string> = {
    'janeiro': '01', 'fevereiro': '02', 'março': '03', 'abril': '04',
    'maio': '05', 'junho': '06', 'julho': '07', 'agosto': '08',
    'setembro': '09', 'outubro': '10', 'novembro': '11', 'dezembro': '12',
  };

  /**
   * Normalises expiration text from the Amazon PSP page into dd/MM/yyyy.
   * Extracts the end date from formats like:
   *   - "Expira em: domingo 15 de março de 2026"
   *   - "De terça-feira 3 de março de 2026 até domingo 15 de março de 2026"
   *   - "De quinta-feira 5 de março de 2026 às 14:30 BRT até quinta-feira 12 de março de 2026"
   * Falls back to the raw text when the pattern is not recognised.
   */
  private parseExpirationText(text: string): string {
    const ateMatch = text.match(/até\s+(.+?)$/i);
    const expiraMatch = text.match(/Expira\s+em:\s*(.+?)$/i);
    const dateFragment = ateMatch?.[1]?.trim() ?? expiraMatch?.[1]?.trim() ?? text;

    return this.formatPtBrDate(dateFragment) ?? dateFragment;
  }

  /**
   * Converts a pt-BR date fragment like "domingo 15 de março de 2026" into "15/03/2026".
   * Returns null when the fragment doesn't match the expected pattern.
   */
  private formatPtBrDate(fragment: string): string | null {
    const m = fragment.match(/(\d{1,2})\s+de\s+(\S+)\s+de\s+(\d{4})/i);
    if (!m) return null;

    const day = m[1].padStart(2, '0');
    const month = CheerioHtmlParser.MONTH_MAP[m[2].toLowerCase()];
    const year = m[3];

    if (!month) return null;
    return `${day}/${month}/${year}`;
  }

  /**
   * Extracts structured product data from an Amazon product detail page.
   * Uses multiple selector fallbacks for each field to handle page layout variations.
   */
  extractProductInfo(html: string, asin: string, url: string, logger?: Logger): ProductPage {
    const $ = cheerio.load(html);

    const title = this.extractTitle($);
    const { price, originalPrice } = this.extractPrices($, logger);
    const prime = this.extractPrime($);
    const { rating, reviewCount } = this.extractReviews($);
    const couponInfo = this.extractCouponInfo(html);
    const offerId = this.extractOfferId($);
    const { inStock, isPreOrder } = this.extractAvailability($, offerId, logger);

    return {
      asin,
      title,
      price,
      originalPrice,
      prime,
      rating,
      reviewCount,
      hasCoupon: couponInfo !== null,
      couponInfo,
      url,
      offerId,
      inStock,
      imageUrl: this.extractImageUrl($),
      isPreOrder,
      format: this.extractFormat($),
      publisher: this.extractPublisher($),
      contributors: this.extractContributors($),
      productGroup: this.extractProductGroup(html),
    };
  }

  private extractTitle($: cheerio.CheerioAPI): string {
    return (
      $('#productTitle').text().trim() ||
      $('[data-automation-id="product-title"]').text().trim() ||
      $('h1.a-size-large').first().text().trim() ||
      ''
    );
  }

  private extractPrices($: cheerio.CheerioAPI, logger?: Logger): { price: string | null; originalPrice: string | null } {
    const priceSelectors = [
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '#price_inside_buybox',
      '.a-price[data-a-color="price"] .a-offscreen',
      '.priceToPay .a-offscreen',
      '#corePrice_feature_div .a-price .a-offscreen',
      '#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen',
    ];

    let price: string | null = null;
    for (const sel of priceSelectors) {
      const val = $(sel).first().text().trim();
      if (val) {
        price = val;
        break;
      }
    }

    // Fallback: reconstruct from visible sub-elements when .a-offscreen is empty
    if (price === null) {
      const reconstructed = this.reconstructPrice($, [
        '.priceToPay',
        '#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price)',
      ]);
      price = reconstructed || null;
    }

    if (price === null) {
      logger?.warn('Price selector returned no value — product page may be missing price', {});
    }

    const originalPriceSelectors = [
      '.a-price.a-text-price .a-offscreen',
      '#priceblock_listprice',
      '#listPrice',
      '.basisPrice .a-offscreen',
    ];

    let originalPrice: string | null = null;
    for (const sel of originalPriceSelectors) {
      const val = $(sel).first().text().trim();
      if (val && val !== price) {
        originalPrice = val;
        break;
      }
    }

    return { price, originalPrice };
  }

  /**
   * Reconstructs a price string from visible `.a-price-symbol`, `.a-price-whole`,
   * and `.a-price-fraction` sub-elements. Used when `.a-offscreen` is empty.
   */
  private reconstructPrice($: cheerio.CheerioAPI, containerSelectors: string[]): string {
    for (const sel of containerSelectors) {
      const container = $(sel).first();
      if (container.length === 0) continue;

      const symbol = container.find('.a-price-symbol').first().text().trim();
      const whole = container.find('.a-price-whole').first().contents().first().text().trim();
      const fraction = container.find('.a-price-fraction').first().text().trim();

      if (whole) {
        return fraction ? `${symbol}${whole},${fraction}` : `${symbol}${whole}`;
      }
    }
    return '';
  }

  private extractPrime($: cheerio.CheerioAPI): boolean {
    if ($('.a-icon-prime').length > 0) return true;
    if ($('[data-feature-name="primeDetails"]').length > 0) return true;
    const deliveryText = $('#mir-layout-DELIVERY_BLOCK').text().toLowerCase();
    return deliveryText.includes('prime');
  }

  private extractReviews($: cheerio.CheerioAPI): { rating: number; reviewCount: number } {
    // Rating: "4.5 out of 5 stars" or "4,5 de 5 estrelas"
    let rating = 0;
    const ratingText =
      $('[data-hook="rating-out-of-text"]').text().trim() ||
      $('.a-icon-star .a-icon-alt').first().text().trim() ||
      $('i[data-hook="average-star-rating"] .a-icon-alt').first().text().trim();

    const ratingMatch = ratingText.match(/(\d[.,]\d)/);
    if (ratingMatch) {
      rating = parseFloat(ratingMatch[1].replace(',', '.'));
    }

    // Review count: "1.234 ratings" or "1.234 avaliações"
    let reviewCount = 0;
    const countText =
      $('[data-hook="total-review-count"]').text().trim() ||
      $('#acrCustomerReviewText').text().trim();

    const countMatch = countText.replace(/\./g, '').match(/(\d+)/);
    if (countMatch) {
      reviewCount = parseInt(countMatch[1], 10);
    }

    return { rating, reviewCount };
  }

  private extractOfferId($: cheerio.CheerioAPI): string | undefined {
    return $('#merchantID').attr('value') || undefined;
  }

  private extractAvailability(
    $: cheerio.CheerioAPI,
    offerId: string | undefined,
    logger?: Logger,
  ): { inStock: boolean; isPreOrder: boolean } {
    const text = $('#availability .primary-availability-message').text().trim();

    const isOutOfStock =
      text.includes('Não disponível') ||
      text.includes('Indisponível') ||
      text.toLowerCase().includes('fora de estoque') ||
      text.includes('Temporariamente indisponível');

    const inStock = !!offerId && !isOutOfStock;

    const isPreOrder =
      $('.a-button-preorder').length > 0 ||
      text.toLowerCase().includes('pré-venda') ||
      text.includes('não foi lançado');

    const isKnownInStockText =
      text.toLowerCase().includes('em estoque') ||
      text.toLowerCase().includes('disponível');

    if (text && !isKnownInStockText && !isOutOfStock && !isPreOrder) {
      logger?.warn('Unknown availability text', { text });
    }

    return { inStock, isPreOrder };
  }

  private extractImageUrl($: cheerio.CheerioAPI): string | undefined {
    const raw =
      $('#landingImage').attr('data-old-hires') ||
      $('#landingImage').attr('src') ||
      undefined;
    return raw ? normalizeAmazonImageUrl(raw) : undefined;
  }

  private extractFormat($: cheerio.CheerioAPI): string | undefined {
    const label = $('#tmmSwatches .swatchElement.selected [aria-label]').attr('aria-label');
    return label?.replace(/\s*Formato:$/, '').trim() || undefined;
  }

  private extractPublisher($: cheerio.CheerioAPI): string | undefined {
    return (
      $('#rpi-attribute-book_details-publisher .rpi-attribute-value span').text().trim() ||
      undefined
    );
  }

  private extractContributors($: cheerio.CheerioAPI): string[] {
    const contributors: string[] = [];

    $('#bylineInfo .author').each((_, el) => {
      const name = $(el).find('a.a-link-normal').first().text().trim();
      if (!name) return;

      contributors.push(name);
    });

    return contributors;
  }

  private extractProductGroup(html: string): string | undefined {
    const raw = html.match(/"productGroupID"\s*:\s*"([^"]+)"/)?.[1];
    if (!raw) return undefined;

    if (PRODUCT_GROUP_LABELS[raw]) return PRODUCT_GROUP_LABELS[raw];

    const stripped = raw.replace(/_display_on_website$/, '');
    return stripped
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  /**
   * Extracts ASINs from an Amazon search results page.
   * Selects elements with `data-component-type="s-search-result"` and reads their `data-asin`.
   */
  extractSearchResultAsins(html: string): string[] {
    const $ = cheerio.load(html);
    const asins: string[] = [];

    $('[data-component-type="s-search-result"][data-asin]').each((_, el) => {
      const asin = $(el).attr('data-asin')?.trim();
      if (asin) {
        asins.push(asin);
      }
    });

    return asins;
  }

  /**
   * Checks whether the search results page has a next page link.
   * Tries multiple selectors to handle layout variations.
   */
  hasNextSearchPage(html: string): boolean {
    const $ = cheerio.load(html);

    if ($('.s-pagination-next:not(.s-pagination-disabled)').length > 0) {
      return true;
    }

    if ($('a.s-pagination-next').length > 0) {
      return true;
    }

    if ($('li.a-last a').length > 0) {
      return true;
    }

    return false;
  }

  /**
   * Extracts a coupon code from the product page text.
   * Looks for patterns like "com o cupom FJOVKLWWIZXM" or "cupom FJOVKLWWIZXM"
   * in coupon-related elements and their surrounding context.
   */
  private extractCouponCode($: cheerio.CheerioAPI): string | null {
    // Selectors likely to contain coupon text on Amazon product pages
    const selectors = [
      '[id*="coupon"]',
      '[id*="Coupon"]',
      'a[href*="/promotion/psp/"]',
      '#promoPriceBlockMessage_feature_div',
      '#vpcButton',
    ];

    // Search in element text and parent containers
    for (const sel of selectors) {
      const elements = $(sel);
      for (let i = 0; i < elements.length; i++) {
        const el = elements.eq(i);
        // Check the element and its parent for coupon code text
        const textsToCheck = [
          el.text(),
          el.parent().text(),
          el.closest('div').text(),
        ];

        for (const text of textsToCheck) {
          const code = this.matchCouponCode(text);
          if (code) return code;
        }
      }
    }

    // Fallback: scan full page text (title area, promo blocks)
    const bodyText = $('body').text();
    return this.matchCouponCode(bodyText);
  }

  /**
   * Matches a coupon code from text using known Brazilian Amazon patterns.
   * Returns the code in uppercase, or null if no match.
   */
  private matchCouponCode(text: string): string | null {
    // Pattern: "com o cupom XXXX" (most common)
    const withCupom = text.match(/com o cupom\s+([A-Z0-9]{6,20})/i);
    if (withCupom?.[1]) return withCupom[1].toUpperCase();

    // Pattern: "cupom XXXX" (shorter variant)
    const shortCupom = text.match(/cupom\s+([A-Z0-9]{6,20})/i);
    if (shortCupom?.[1]) return shortCupom[1].toUpperCase();

    // Pattern: "coupon XXXX" (English variant)
    const coupon = text.match(/coupon\s+([A-Z0-9]{6,20})/i);
    if (coupon?.[1]) return coupon[1].toUpperCase();

    return null;
  }

  private parseCouponHref(href: string): CouponInfo | null {
    try {
      const fullUrl = href.startsWith('http')
        ? new URL(href)
        : new URL(href, 'https://www.amazon.com.br');

      const pathParts = fullUrl.pathname.split('/');
      const pspIndex = pathParts.indexOf('psp');
      if (pspIndex === -1 || pspIndex + 1 >= pathParts.length) {
        return null;
      }

      const promotionId = pathParts[pspIndex + 1];
      const redirectAsin = fullUrl.searchParams.get('redirectAsin') ?? '';
      const redirectMerchantId = fullUrl.searchParams.get('redirectMerchantId') ?? '';

      if (!promotionId) {
        return null;
      }

      return {
        promotionId,
        redirectAsin,
        redirectMerchantId,
        promotionMerchantId: redirectMerchantId,
        couponCode: null,
      };
    } catch {
      return null;
    }
  }
}
