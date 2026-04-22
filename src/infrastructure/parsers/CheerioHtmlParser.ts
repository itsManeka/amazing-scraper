import * as cheerio from 'cheerio';
import { HtmlParser } from '../../application/ports/HtmlParser';
import { Logger } from '../../application/ports/Logger';
import {
  CouponInfo,
  CouponMetadata,
  IndividualCouponInfo,
  ProductPage,
} from '../../domain/entities';

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
   * Internal variant of extractAllCoupons that accepts pre-parsed Cheerio API.
   * Used by extractProductInfo to avoid re-parsing the HTML.
   */
  private _extractAllCoupons($: cheerio.CheerioAPI): CouponInfo[] {
    const results: CouponInfo[] = [];

    // Note: script/style already removed in extractProductInfo via extraction of other fields
    // (e.g., extractTitle, extractPrices), so we DON'T remove again here.
    // Removing again would be redundant but safe (idempotent).
    // However, for clarity and consistency with the public extractAllCoupons,
    // we omit the global removal here and rely on container-level removal below.

    // Pre-compute applicable promotion IDs (skip these in PSP detection)
    const applicablePromotionIds = new Set<string>();
    $('[data-csa-c-owner="PromotionsDiscovery"][data-csa-c-item-id*="amzn1.promotion."]').each((_, el) => {
      const itemId = $(el).attr('data-csa-c-item-id') ?? '';
      const promotionMatch = itemId.match(/amzn1\.promotion\.([A-Z0-9]+)/);
      if (promotionMatch) {
        const promotionId = promotionMatch[1];
        const elementHtml = $(el).html() ?? '';
        if (elementHtml.includes(`/promotion/psp/${promotionId}`)) {
          const containerText = $(el).clone().find('style, script').remove().end().text();
          const normalizedText = this.normalizeText(containerText);
          const isApplicablePattern = /Aplicar\s+cupom\s+de\s+\d{1,2}%/i.test(normalizedText);
          if (isApplicablePattern) {
            applicablePromotionIds.add(promotionId);
          }
        }
      }
    });

    // Main loop: iterate all PromotionsDiscovery containers
    $('[data-csa-c-owner="PromotionsDiscovery"][data-csa-c-item-id*="amzn1.promotion."]').each((_, el) => {
      const itemId = $(el).attr('data-csa-c-item-id') ?? '';
      const promotionMatch = itemId.match(/amzn1\.promotion\.([A-Z0-9]+)/);
      if (!promotionMatch) return; // Skip if no promotionId

      const promotionId = promotionMatch[1];
      const container = $(el);
      const containerHtml = container.html() ?? '';

      // ========== PSP DETECTION (via container-scoped /promotion/psp/ link) ==========
      if (
        containerHtml.includes(`/promotion/psp/${promotionId}`) &&
        !applicablePromotionIds.has(promotionId)
      ) {
        const couponCode = this.extractCouponCode($, container);
        const couponInfo: CouponInfo = {
          promotionId,
          redirectAsin: '',
          redirectMerchantId: '',
          promotionMerchantId: '',
          couponCode,
        };
        results.push(couponInfo);
        return; // Move to next container
      }

      // ========== INDIVIDUAL COUPON DETECTION ==========
      // Extract inline coupon text (classic "Insira o código" or applicable "Aplicar cupom de X%")
      const promoMessageEl = container.find('[id^="promoMessageCXCW"]').first();
      const couponTextEl = container.find('[id^="couponText"]').first();
      let promoMessageText: string;
      if (promoMessageEl.length > 0) {
        promoMessageText = promoMessageEl.clone().find('style, script').remove().end().text();
      } else if (couponTextEl.length > 0) {
        promoMessageText = couponTextEl.clone().find('style, script').remove().end().text();
      } else {
        promoMessageText = container.clone().find('style, script').remove().end().text();
      }

      const rawMessageText = this.normalizeText(promoMessageText);

      // Try classic individual coupon pattern: "Insira o código X"
      const codeMatch =
        rawMessageText.match(/Insira\s+o\s+c[óo]digo\s+([A-Z0-9]{4,20})/i) ??
        rawMessageText.match(/cupom:\s*([A-Z0-9]{4,20})/i);
      const couponCode = codeMatch?.[1]?.toUpperCase() ?? null;

      if (couponCode) {
        // Classic individual coupon detected
        const couponInfo: CouponInfo = {
          promotionId,
          couponCode,
          redirectAsin: '',
          redirectMerchantId: '',
          promotionMerchantId: '',
        };
        results.push(couponInfo);
        return;
      }

      // Try applicable pattern: "Aplicar cupom de X%"
      const applicableMatch = rawMessageText.match(/Aplicar\s+cupom\s+de\s+(\d{1,2})%/i);
      if (applicableMatch) {
        const couponInfo: CouponInfo = {
          promotionId,
          couponCode: null,
          redirectAsin: '',
          redirectMerchantId: '',
          promotionMerchantId: '',
        };
        results.push(couponInfo);
        return;
      }

      // No clear coupon signal — skip this container
    });

    return results;
  }

  /**
   * Internal variant of extractCouponInfo that accepts pre-parsed Cheerio API.
   * Used by extractProductInfo to avoid re-parsing the HTML.
   */
  private _extractCouponInfo($: cheerio.CheerioAPI): CouponInfo | null {
    let couponHref: string | null = null;

    // CRITICAL PRECEDENCE CHECK (applies before Patterns 1-4):
    // If there's a /promotion/psp/ link INSIDE a PromotionsDiscovery container with
    // "Aplicar cupom de X%", it's an applicable coupon, not a PSP.
    // Return null here to let extractIndividualCouponInfo handle it with isApplicable: true.
    const applicablePromotionIds = new Set<string>();
    $('[data-csa-c-owner="PromotionsDiscovery"]').each((_, el) => {
      const itemId = $(el).attr('data-csa-c-item-id') ?? '';
      const promotionMatch = itemId.match(/amzn1\.promotion\.([A-Z0-9]+)/);
      if (promotionMatch) {
        const promotionId = promotionMatch[1];
        const elementHtml = $(el).html() ?? '';
        if (elementHtml.includes(`/promotion/psp/${promotionId}`)) {
          const containerText = $(el).clone().find('style, script').remove().end().text();
          const normalizedText = this.normalizeText(containerText);
          const isApplicablePattern = /Aplicar\s+cupom\s+de\s+\d{1,2}%/i.test(normalizedText);
          if (isApplicablePattern) {
            applicablePromotionIds.add(promotionId);
          }
        }
      }
    });

    // Pattern 1: <a href="/promotion/psp/..."> — but skip if it's an applicable coupon
    $('a[href*="/promotion/psp/"]').each((_, el) => {
      if (!couponHref) {
        const href = $(el).attr('href') ?? null;
        if (href) {
          const promotionMatch = href.match(/\/promotion\/psp\/([A-Z0-9]+)/);
          const promotionId = promotionMatch?.[1];
          if (promotionId && !applicablePromotionIds.has(promotionId)) {
            couponHref = href;
          }
        }
      }
    });

    // Pattern 2: elements with id containing "coupon" → find child anchor
    if (!couponHref) {
      $('[id*="coupon"] a, [id*="Coupon"] a').each((_, el) => {
        if (!couponHref) {
          const href = $(el).attr('href') ?? '';
          if (href.includes('/promotion/psp/')) {
            const promotionMatch = href.match(/\/promotion\/psp\/([A-Z0-9]+)/);
            const promotionId = promotionMatch?.[1];
            if (promotionId && !applicablePromotionIds.has(promotionId)) {
              couponHref = href;
            }
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
              const promotionMatch = href.match(/\/promotion\/psp\/([A-Z0-9]+)/);
              const promotionId = promotionMatch?.[1];
              if (promotionId && !applicablePromotionIds.has(promotionId)) {
                couponHref = href;
              }
            }
          }
        }
      });
    }

    // Pattern 4: BXGY (buy-x-get-y) link with /fmc/xb-store/buy-x-get-y
    // Restricted to #promoPriceBlockMessage_feature_div or [data-csa-c-owner="PromotionsDiscovery"]
    // so we do not pick up unrelated BXGY links elsewhere on the page.
    // Accepts both absolute URLs (https://www.amazon.com.br/fmc/xb-store/buy-x-get-y?...)
    // and relative paths (/fmc/xb-store/buy-x-get-y?...) from raw scraper HTML.
    let bxgyInfo: CouponInfo | null = null;
    if (!couponHref) {
      const bxgyDomainPattern = /^(https?:\/\/(www\.)?amazon\.com\.br)?\/fmc\/xb-store\/buy-x-get-y\?/;
      const bxgySelector =
        '#promoPriceBlockMessage_feature_div a[href*="/fmc/xb-store/buy-x-get-y"], ' +
        '[data-csa-c-owner="PromotionsDiscovery"] a[href*="/fmc/xb-store/buy-x-get-y"]';
      $(bxgySelector).each((_, el) => {
        if (bxgyInfo) return;
        const href = $(el).attr('href') ?? '';
        if (!bxgyDomainPattern.test(href)) return;

        const url = new URL(href.startsWith('http') ? href : `https://www.amazon.com.br${href}`);
        const promotionId = url.searchParams.get('promotionId');
        if (!promotionId || !/^[A-Z0-9]+$/.test(promotionId)) return;

        const redirectAsin = url.searchParams.get('redirectAsin') ?? '';
        const redirectMerchantId = url.searchParams.get('redirectMerchantId') ?? '';
        bxgyInfo = {
          promotionId,
          redirectAsin,
          redirectMerchantId,
          promotionMerchantId: redirectMerchantId,
          couponCode: null,
        };
      });
      if (bxgyInfo) {
        return bxgyInfo;
      }
    }

    // Pattern 5: Fallback for BXGY — /promotion/psp/ serialized in JSON within PromotionsDiscovery
    // + amzn1.promotion ID in data-csa-c-item-id
    // NOTE: Applicable coupons are already filtered out by applicablePromotionIds above,
    // so this fallback will only match true PSP promotions.
    if (!couponHref) {
      let fallbackInfo: CouponInfo | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: usar AnyNode de domhandler quando cheerio re-exportar o tipo
      let fallbackContainer: cheerio.Cheerio<any> | undefined;
      $('[data-csa-c-owner="PromotionsDiscovery"]').each((_, el) => {
        if (fallbackInfo) return;

        const itemId = $(el).attr('data-csa-c-item-id') ?? '';
        const promotionMatch = itemId.match(/amzn1\.promotion\.([A-Z0-9]+)/);
        if (!promotionMatch) return;

        const promotionId = promotionMatch[1];

        // Skip if this is an applicable coupon (filtered above)
        if (applicablePromotionIds.has(promotionId)) return;

        // Look for /promotion/psp/{ID} anywhere in the element HTML
        const elementHtml = $(el).html() ?? '';
        if (elementHtml.includes(`/promotion/psp/${promotionId}`)) {
          // Extract redirectAsin from ASIN in data-csa-c-item-id (format: amzn1.asin.{ASIN}:...)
          const asinMatch = itemId.match(/amzn1\.asin\.([A-Z0-9]+)/);
          const redirectAsin = asinMatch?.[1] ?? '';
          // redirectMerchantId from buybox or fallback to empty (will be filled later if needed)
          const redirectMerchantId = '';

          fallbackInfo = {
            promotionId,
            redirectAsin,
            redirectMerchantId,
            promotionMerchantId: redirectMerchantId,
            couponCode: null,
          };
          // Store the container element (the DOM node) for scoped coupon code extraction
          fallbackContainer = $(el);
        }
      });
      if (fallbackInfo) {
        // Extract coupon code from within the scoped container
        // FORCE: only use container-scoped extraction, never fall back to global
        const couponCode = fallbackContainer ? this.extractCouponCode($, fallbackContainer) : null;
        (fallbackInfo as CouponInfo).couponCode = couponCode;
        return fallbackInfo;
      }
    }

    if (!couponHref) {
      return null;
    }

    // Derive scoped container from couponHref to prevent cross-coupon code leak (f07)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: usar AnyNode de domhandler quando cheerio re-exportar o tipo
    let scopedContainer: cheerio.Cheerio<any> | undefined;
    const hrefPromotionMatch = (couponHref as string).match(/\/promotion\/psp\/([A-Z0-9]+)/);
    const hrefPromotionId = hrefPromotionMatch?.[1];
    if (hrefPromotionId) {
      const candidate = $(`[data-csa-c-item-id*="amzn1.promotion.${hrefPromotionId}"]`).first()
        .closest('[data-csa-c-owner="PromotionsDiscovery"]');
      if (candidate.length > 0) {
        scopedContainer = candidate;
      }
    }

    const couponCode = this.extractCouponCode($, scopedContainer);
    const info = this.parseCouponHref(couponHref);
    if (info) {
      info.couponCode = couponCode;
    }
    return info;
  }

  /**
   * Extracts coupon promotion info from a product page.
   * Public version: parses HTML once and delegates to _extractCouponInfo.
   *
   * Tries 5 patterns in order:
   * 1. Anchor tags with `/promotion/psp/` in href
   * 2. Elements with id containing "coupon" that wrap an anchor
   * 3. Anchor tags with text containing "cupom", "coupon", or "Clique para aplicar"
   * 4. BXGY (buy-x-get-y) link with `/fmc/xb-store/buy-x-get-y` and promotionId parameter
   * 5. Fallback: `/promotion/psp/` serialized in JSON + amzn1.promotion ID in PromotionsDiscovery
   */
  extractCouponInfo(html: string): CouponInfo | null {
    const $ = cheerio.load(html);

    // Strip <script>/<style> from the local DOM before any text() extraction so
    // inline JS comments like "Initialize the coupon handler module" do not leak
    // into the coupon-code regex (false positive: coupon code "HANDLER").
    $('script, style').remove();

    return this._extractCouponInfo($);
  }

  /**
   * Internal variant of extractIndividualCouponInfo that accepts pre-parsed Cheerio API.
   * Used by extractProductInfo to avoid re-parsing the HTML.
   */
  private _extractIndividualCouponInfo(
    $: cheerio.CheerioAPI,
    couponInfoAlreadyFound: boolean,
  ): IndividualCouponInfo | null {
    // Prioritise PSP coupons — individual detection only applies when the
    // product page has no /promotion/psp/ link.
    if (couponInfoAlreadyFound) {
      return null;
    }

    let result: IndividualCouponInfo | null = null;

    $('[data-csa-c-owner="PromotionsDiscovery"][data-csa-c-item-id*="amzn1.promotion."]').each(
      (_, el) => {
        if (result) return;

        const itemId = $(el).attr('data-csa-c-item-id') ?? '';
        const promotionMatch = itemId.match(/amzn1\.promotion\.([A-Z0-9]+)/);
        if (!promotionMatch) return;

        const promotionId = promotionMatch[1];

        // 1. discountText: badge element (label) adjacent to promoMessageCXCW
        const rawDiscountText =
          this.normalizeText($(el).find('label').first().text()) ||
          this.normalizeText($(el).find('.recommended-discovery').first().text()) ||
          null;
        const discountText = rawDiscountText && rawDiscountText.length > 0 ? rawDiscountText : null;

        // 2. Coupon code and cleaned description from the inline promo message
        // Clone the element and remove <style>/<script> before calling .text() to prevent
        // CSS rules injected by Amazon from leaking into the description text.
        const promoMessageEl = $(el).find('[id^="promoMessageCXCW"]').first();
        const couponTextEl = $(el).find('[id^="couponText"]').first(); // Applicable pattern fallback
        let promoMessageText: string;
        if (promoMessageEl.length > 0) {
          promoMessageText = promoMessageEl.clone().find('style, script').remove().end().text();
        } else if (couponTextEl.length > 0) {
          promoMessageText = couponTextEl.clone().find('style, script').remove().end().text();
        } else {
          promoMessageText = $(el).clone().find('style, script').remove().end().text();
        }
        const rawMessageText = this.normalizeText(promoMessageText);
        const codeMatch =
          rawMessageText.match(/Insira\s+o\s+c[óo]digo\s+([A-Z0-9]{4,20})/i) ??
          rawMessageText.match(/cupom:\s*([A-Z0-9]{4,20})/i);
        const couponCode = codeMatch?.[1]?.toUpperCase() ?? null;

        // Remove leading "off." prefix and trailing "Termos" from description
        // Also remove "Ver Itens Participantes" and trailing pipe for applicable coupons
        const cleanedMessage = rawMessageText
          .replace(/^\s*off\.\s*/i, '')
          .replace(/\s+\|\s*Ver\s+Itens\s+Participantes\s*/i, '')
          .replace(/\s*Termos\s*$/, '')
          .trim();
        const description = cleanedMessage.length > 0 ? cleanedMessage : null;

        // termsUrl: parse JSON in data-a-modal of the declarative wrapper.
        // The browser-saved HTML already decodes &quot; to " in the attribute,
        // so JSON.parse succeeds on the raw attribute value.
        let termsUrl: string | null = null;
        const modalAttr = $(el).find('[data-a-modal]').first().attr('data-a-modal');
        if (modalAttr) {
          try {
            const parsed = JSON.parse(modalAttr) as { url?: unknown };
            if (typeof parsed.url === 'string' && parsed.url.length > 0) {
              termsUrl = parsed.url;
            }
          } catch {
            // Malformed JSON — fall back to null; terms are optional.
          }
        }

        // ===== CLASSIC FLOW: "Insira o código X" / "cupom: X" =====
        // Try classic individual coupon pattern first.
        if (couponCode) {
          result = {
            promotionId,
            couponCode,
            discountText,
            description,
            termsUrl,
            isIndividual: true,
          };
          return;
        }

        // ===== APPLICABLE FLOW: "Aplicar cupom de X%" =====
        // If classic pattern didn't match, try the applicable pattern.
        const applicableMatch = rawMessageText.match(/Aplicar\s+cupom\s+de\s+(\d{1,2})%/i);
        if (applicableMatch) {
          const discountPercent = Number(applicableMatch[1]);

          // Extract participatingProductsUrl: href of "Ver Itens Participantes" link
          let participatingProductsUrl: string | null = null;
          const participatingLink = $(el)
            .find('a')
            .filter((_, linkEl) => {
              const linkText = this.normalizeText($(linkEl).text());
              return /Ver\s+Itens\s+Participantes/i.test(linkText);
            })
            .first();
          if (participatingLink.length > 0) {
            const href = participatingLink.attr('href');
            if (href && href.length > 0) {
              participatingProductsUrl = href;
            }
          }

          result = {
            promotionId,
            couponCode: null,
            discountText: null,
            description: cleanedMessage.length > 0 ? cleanedMessage : null,
            termsUrl,
            isIndividual: true,
            isApplicable: true,
            participatingProductsUrl,
            discountPercent,
          };
          return;
        }

        // Filter out informative promotions (e.g., pre-order guarantees) that lack coupon signals:
        // - couponCode must be extracted (signal 1)
        // - discountText must be present (signal 2)
        // - promoMessageCXCW element must exist (signal 3)
        // If none of these signals are present, it's not a real coupon.
        const hasPromoMessage = promoMessageEl.length > 0;
        if (!couponCode && !discountText && !hasPromoMessage) {
          return;
        }

        // Fallback: if the classic flow detected signals but no coupon code,
        // return a partial result (should rarely happen with current fixtures).
        result = {
          promotionId,
          couponCode,
          discountText,
          description,
          termsUrl,
          isIndividual: true,
        };
      },
    );

    return result;
  }

  /**
   * Extracts an inline "individual" coupon from a product detail page.
   *
   * Locates the `PromotionsDiscovery` container inside
   * `#promoPriceBlockMessage_feature_div` whose `data-csa-c-item-id`
   * encodes a promotion id (`amzn1.promotion.{ID}`). The terms URL is
   * read from the `data-a-modal` JSON attribute of the nested
   * `<span class="a-declarative">` wrapper (the `href` of the "Termos"
   * link points to the product page, not the popover endpoint).
   *
   * Detects two patterns within the PromotionsDiscovery container:
   * 1. **Classic flow:** "Insira o código X" / "cupom: X" — standard inline coupons with
   *    a specific coupon code for the product.
   * 2. **Applicable flow:** "Aplicar cupom de X%" — generic promotional discounts without
   *    a product-specific code (flagged via `isApplicable: true`). May include a link to
   *    participating products ("Ver Itens Participantes") exposed via `participatingProductsUrl`.
   *
   * If the page already contains a PSP-style coupon
   * (`/promotion/psp/`), this method returns `null` so PSP coupons take
   * precedence.
   */
  extractIndividualCouponInfo(html: string): IndividualCouponInfo | null {
    const $ = cheerio.load(html);

    // Strip <script>/<style> from the local DOM before any text() extraction
    $('script, style').remove();

    // Check if PSP coupon is present (same logic as _extractCouponInfo's early priority check)
    const couponInfoFound = this._extractCouponInfo($) !== null;

    return this._extractIndividualCouponInfo($, couponInfoFound);
  }

  /**
   * Extracts all coupons from a product detail page by iterating over
   * PromotionsDiscovery containers and classifying each independently.
   *
   * Returns an array of CouponInfo objects, one per container. Each coupon is
   * extracted with container-scoped context (pattern F07) to prevent cross-coupon
   * code leakage.
   *
   * Classification precedence (per container):
   * 1. PSP (has /promotion/psp/ link) — CouponInfo
   * 2. Individual (no /promotion/psp/, has "Insira o código" pattern) — CouponInfo with isIndividual
   * 3. Applicable (no /promotion/psp/, has "Aplicar cupom de X%" pattern) — CouponInfo with isApplicable
   * 4. Skip containers without clear coupon signals
   *
   * This method is the authoritative source for all coupons on a page;
   * extractCouponInfo and extractIndividualCouponInfo delegate to this for backward compatibility.
   */
  /**
   * Extracts all coupons from a product detail page by iterating over PromotionsDiscovery
   * containers and classifying each as PSP, individual (classic), or applicable.
   *
   * Public version: parses HTML once and delegates to _extractAllCoupons.
   * This method is the authoritative source for all coupons on a page;
   * extractCouponInfo and extractIndividualCouponInfo maintain legacy behavior for backward compatibility.
   */
  extractAllCoupons(html: string): CouponInfo[] {
    const $ = cheerio.load(html);

    // Strip <script>/<style> early to prevent text() leakage (same as extractCouponInfo)
    $('script, style').remove();

    return this._extractAllCoupons($);
  }

  /**
   * Extracts the terms text from the HTML fragment returned by the
   * individual coupon popover endpoint (`/promotion/details/popup/{ID}`).
   *
   * Two shapes are supported:
   *
   * 1. Post-JS DOM (fixture extracted from a rendered page or a popover that
   *    Amazon already populated): the `<span id="promo_tnc_content_{ID}_{SUFFIX}">`
   *    already contains the rendered rules text. Matched via
   *    `[id^="promo_tnc_content_"]`.
   *
   * 2. Raw server response from `/promotion/details/popup/{ID}`: the span is
   *    empty and the text lives inline inside a `<script>` that invokes
   *    `tncComponent.renderTnC({"tncSectionContentMap":{"TNC_CONTENT": "..."}})`.
   *    Requires parsing the script JSON and then stripping residual HTML tags
   *    that may appear inside `TNC_CONTENT` (e.g. `<br>`, `<span>`).
   *
   * Normalisation (`\u00a0` → space, trim) is applied after extraction.
   */
  extractIndividualCouponTerms(html: string): string | null {
    const $ = cheerio.load(html);

    const spanText = this.normalizeText($('[id^="promo_tnc_content_"]').first().text());
    if (spanText.length > 0) {
      return spanText;
    }

    const scriptText = this.extractTermsFromRenderTnCScript($);
    return scriptText && scriptText.length > 0 ? scriptText : null;
  }

  /**
   * Extracts the expiration date from individual coupon terms text.
   * Receives already-parsed terms text (not HTML) and extracts the date
   * using lazy regex pattern "ate DD de MMMM de YYYY" or "ate DD de MMMM de YYYY as HH:MM".
   * Returns the date in format "dd/MM/yyyy" or null when the pattern is not found.
   * Uses lazy quantifier (.+?) to prevent ReDoS attacks on long input strings.
   * Normalises accented "até"/"às" to "ate"/"as" before regex to handle Unicode correctly.
   *
   * Input validation: Rejects strings longer than 10,000 characters to mitigate
   * against pathological ReDoS scenarios with many "ate " fragments.
   */
  extractIndividualCouponExpiration(termsText: string): string | null {
    if (!termsText || termsText.length === 0) {
      return null;
    }

    // Guard against pathologically long inputs that could cause performance issues
    if (termsText.length > 10_000) {
      return null;
    }

    // Normalize input: replace non-breaking spaces with regular spaces and trim
    const normalized = this.normalizeText(termsText);

    // Replace accented variants for regex matching:
    // "até" → "ate", "às" → "as" to standardise for regex
    // This handles Unicode variants like "Até", "ATÉ", "Às", "AS", etc.
    let normalizedForRegex = normalized.replace(/até/gi, 'ate');
    normalizedForRegex = normalizedForRegex.replace(/às/gi, 'as');

    // Extract date using anchored regex to match the expected PT-BR date format.
    // Pattern: "ate DD de MMMM de YYYY [as HH:MM]"
    // Anchors on digits + month names to avoid capturing intermediate text between multiple "ate" occurrences.
    // If multiple "ate" patterns exist, extracts the first valid match that produces a non-null date.
    const ateMatches = normalizedForRegex.matchAll(
      /ate\s+(\d{1,2}\s+de\s+[a-zç]+\s+de\s+\d{4}(?:\s+as\s+\d{1,2}:\d{2})?)/gi,
    );

    for (const match of ateMatches) {
      if (!match[1]) continue;
      const dateFragment = match[1].trim();
      const result = this.formatPtBrDate(dateFragment);
      if (result !== null) {
        return result;
      }
    }

    return null;
  }

  /**
   * Fallback extractor for the raw popover response: iterates over every
   * inline `<script>` located by Cheerio, applies a non-greedy regex to
   * isolate the first `tncComponent.renderTnC({...})` invocation, and
   * `JSON.parse`s its argument.
   *
   * The regex runs against a single `<script>` body at a time (bounded
   * input) rather than the full HTML document. This caps the worst-case
   * regex work per script and keeps pathological / malformed documents
   * from blowing up the parser (ReDoS hardening). The regex itself still
   * relies on the JS engine's native backtracking to locate the matching
   * `}\s*)` — intentional and safe given the bounded input.
   *
   * After parsing, `tncSectionContentMap.TNC_CONTENT` is read, residual
   * HTML tags (`<br>`, `<span>`, ...) are stripped, and `normalizeText`
   * is applied.
   *
   * Returns `null` when:
   *   - no script contains a `renderTnC` call;
   *   - the JSON argument is malformed;
   *   - `tncSectionContentMap` / `TNC_CONTENT` is absent or empty.
   */
  private extractTermsFromRenderTnCScript($: cheerio.CheerioAPI): string | null {
    const scripts = $('script').map((_, el) => $(el).html() || '').get();

    for (const script of scripts) {
      const match = script.match(/tncComponent\.renderTnC\(\s*(\{[\s\S]*?\})\s*\)/);
      if (!match?.[1]) continue;

      let payload: unknown;
      try {
        payload = JSON.parse(match[1]);
      } catch {
        // Malformed JSON in this script — keep searching other scripts.
        continue;
      }

      const contentMap = (payload as { tncSectionContentMap?: unknown })?.tncSectionContentMap;
      if (!contentMap || typeof contentMap !== 'object') continue;

      const raw = (contentMap as Record<string, unknown>).TNC_CONTENT;
      if (typeof raw !== 'string' || raw.length === 0) continue;

      // Strip residual HTML tags (Amazon occasionally embeds <br>, <span>, etc.)
      const stripped = raw.replace(/<[^>]+>/g, '');
      const normalised = this.normalizeText(stripped);
      if (normalised.length > 0) {
        return normalised;
      }
    }

    return null;
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
   *
   * Populates both singular `couponInfo` (first PSP for back-compat) and plural
   * `couponInfos` (all coupons from extractAllCoupons) to support legacy and new consumers.
   *
   * OPTIMIZATION: Parses HTML only once via cheerio.load() and passes the $ instance
   * to internal extraction methods, reducing parse overhead from 3-4 to 1-2 Cheerio parses.
   */
  extractProductInfo(html: string, asin: string, url: string, logger?: Logger): ProductPage {
    const $ = cheerio.load(html);

    const title = this.extractTitle($);
    const { price, originalPrice } = this.extractPrices($, logger);
    const prime = this.extractPrime($);
    const { rating, reviewCount } = this.extractReviews($);

    // Extract all coupons (plural) using shared $ to avoid re-parsing
    const allCoupons = this._extractAllCoupons($);

    // Populate singular couponInfo for backward-compat using shared $
    // This avoids re-parsing the HTML that was already loaded above
    const couponInfo = this._extractCouponInfo($);
    const individualCouponInfo = couponInfo === null ? this._extractIndividualCouponInfo($, false) : null;
    const offerId = this.extractOfferId($);
    const { inStock, isPreOrder } = this.extractAvailability($, offerId, logger);

    // hasCoupon now reflects presence of ANY coupon (singular PSP or plural array)
    // This ensures consumers checking `if (product.hasCoupon)` won't miss individual-only coupons
    const hasCoupon = couponInfo !== null || allCoupons.length > 0;

    return {
      asin,
      title,
      price,
      originalPrice,
      prime,
      rating,
      reviewCount,
      hasCoupon,
      couponInfo,
      couponInfos: allCoupons,
      individualCouponInfo,
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
   * Looks for patterns like "com o cupom FJOVKLWWIZXM", "cupom FJOVKLWWIZXM", or "Insira o código GEEK15"
   * in coupon-related elements and their surrounding context.
   *
   * When a container is provided, searches only within that container (no global fallback).
   * When container is omitted, uses the original global fallback for backward compatibility.
   */
  private extractCouponCode(
    $: cheerio.CheerioAPI,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: usar AnyNode de domhandler quando cheerio re-exportar o tipo
    container?: cheerio.Cheerio<any>,
  ): string | null {
    // Selectors likely to contain coupon text on Amazon product pages
    const selectors = [
      '[id*="coupon"]',
      '[id*="Coupon"]',
      'a[href*="/promotion/psp/"]',
      '#promoPriceBlockMessage_feature_div',
      '#vpcButton',
    ];

    // If container is provided, search only within that container
    if (container && container.length > 0) {
      // For scoped extraction (e.g., Pattern 5 PSP fallback), search ONLY within this container
      // Do NOT use the global fallback (#centerCol, #apex_desktop, etc.)
      // This ensures that we do not pick up codes from sibling coupon containers.

      // Strategy: Look for promo text in specific, well-known element patterns
      // These patterns are designed to avoid nested [data-csa-c-owner] containers

      // First: direct text content from immediate children (not recursive descent on nested coupons)
      // Use jQuery's `.children()` which only gets direct children
      const directChildren = container.children();
      for (let i = 0; i < directChildren.length; i++) {
        const child = directChildren.eq(i);
        // Skip nested PromotionsDiscovery containers entirely
        if (child.is('[data-csa-c-owner="PromotionsDiscovery"]')) {
          continue;
        }
        const text = child.text();
        const code = this.matchCouponCode(text);
        if (code) return code;
      }

      // Second: search for specific element patterns that usually contain coupon text
      // but explicitly exclude any nested [data-csa-c-owner] containers
      const couponPatterns = [
        '[id*="coupon"]',
        '[id*="promo"]',
        '[class*="cupom"]',
        '[class*="promo"]',
      ];

      for (const pattern of couponPatterns) {
        const matches = container.find(pattern);
        for (let i = 0; i < matches.length; i++) {
          const el = matches.eq(i);
          // Skip nested coupon containers
          if (el.is('[data-csa-c-owner="PromotionsDiscovery"]')) {
            continue;
          }
          const text = el.text();
          const code = this.matchCouponCode(text);
          if (code) return code;
        }
      }

      // No code found in scoped container
      return null;
    }

    // Original behavior when no container is provided (backward compatibility)
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

    // Fallback: scan restricted containers (exclude ads/feedback widgets outside coupon area)
    const fallbackText = ['#centerCol', '#apex_desktop', '#promoPriceBlockMessage_feature_div']
      .map((sel) => $(sel).text())
      .join(' ');
    if (fallbackText.trim().length > 0) {
      return this.matchCouponCode(fallbackText);
    }

    return null;
  }

  /**
   * Matches a coupon code from text using known Brazilian Amazon patterns.
   * Returns the code in uppercase, or null if no match.
   */
  private matchCouponCode(text: string): string | null {
    // Pattern: "com o cupom XXXX" (most common)
    const withCupom = text.match(/com o cupom\s+([A-Z0-9]{6,20})/i);
    if (withCupom?.[1]) return withCupom[1].toUpperCase();

    // Pattern: "cupom XXXX" / "cupom: XXXX" (shorter variant; ":" optional).
    // Restrict the gap to inline spaces/tabs (no newlines) so a distant "Aplicar"
    // sibling does not get captured when text() spans multiple elements.
    const shortCupom = text.match(/cupom[:\s][ \t]{0,3}([A-Z0-9]{6,20})/i);
    if (shortCupom?.[1]) return shortCupom[1].toUpperCase();

    // Pattern: "coupon XXXX" (English variant)
    const coupon = text.match(/coupon\s+([A-Z0-9]{6,20})/i);
    if (coupon?.[1]) return coupon[1].toUpperCase();

    // Pattern: "Insira o codigo XXXX" (PSP coupon block variant)
    const insiraOCodigo = text.match(/Insira\s+o\s+c[óo]digo\s+([A-Z0-9]{4,20})/i);
    if (insiraOCodigo?.[1]) return insiraOCodigo[1].toUpperCase();

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
