import * as cheerio from 'cheerio';
import { HtmlParser } from '../../application/ports/HtmlParser';
import { Logger } from '../../application/ports/Logger';
import { CouponInfo, ProductPage } from '../../domain/entities';

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

    return this.parseCouponHref(couponHref);
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
   * Extracts structured product data from an Amazon product detail page.
   * Uses multiple selector fallbacks for each field to handle page layout variations.
   */
  extractProductInfo(html: string, asin: string, url: string, logger?: Logger): ProductPage {
    const $ = cheerio.load(html);

    const title = this.extractTitle($);
    const { price, originalPrice } = this.extractPrices($);
    const prime = this.extractPrime($);
    const { rating, reviewCount } = this.extractReviews($);
    const couponInfo = this.extractCouponInfo(html);
    const { inStock, isPreOrder } = this.extractAvailability($, logger);

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
      offerId: this.extractOfferId($),
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

  private extractPrices($: cheerio.CheerioAPI): { price: string; originalPrice: string } {
    // Current price: try common selectors in priority order
    const priceSelectors = [
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '#price_inside_buybox',
      '.a-price[data-a-color="price"] .a-offscreen',
      '.priceToPay .a-offscreen',
      '#corePrice_feature_div .a-price .a-offscreen',
    ];

    let price = '';
    for (const sel of priceSelectors) {
      const val = $(sel).first().text().trim();
      if (val) {
        price = val;
        break;
      }
    }

    // Original (was) price: typically the struck-through price
    const originalPriceSelectors = [
      '.a-price.a-text-price .a-offscreen',
      '#priceblock_listprice',
      '#listPrice',
      '.basisPrice .a-offscreen',
    ];

    let originalPrice = '';
    for (const sel of originalPriceSelectors) {
      const val = $(sel).first().text().trim();
      if (val && val !== price) {
        originalPrice = val;
        break;
      }
    }

    return { price, originalPrice };
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
    logger?: Logger,
  ): { inStock: boolean; isPreOrder: boolean } {
    const text = $('#availability .primary-availability-message').text().trim();
    const inStock = text.includes('Em estoque');
    const isPreOrder =
      $('.a-button-preorder').length > 0 ||
      text.toLowerCase().includes('pré-venda') ||
      text.includes('não foi lançado');

    if (text && !inStock && !isPreOrder) {
      logger?.warn('Unknown availability text', { text });
    }

    return { inStock, isPreOrder };
  }

  private extractImageUrl($: cheerio.CheerioAPI): string | undefined {
    return (
      $('#landingImage').attr('data-old-hires') ||
      $('#landingImage').attr('src') ||
      undefined
    );
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

      const role = $(el)
        .find('.contribution .a-color-secondary')
        .text()
        .replace(/[(),]/g, '')
        .trim();

      contributors.push(role ? `${name} (${role})` : name);
    });

    return contributors;
  }

  private extractProductGroup(html: string): string | undefined {
    return html.match(/"productGroupID"\s*:\s*"([^"]+)"/)?.[1] || undefined;
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
      };
    } catch {
      return null;
    }
  }
}
