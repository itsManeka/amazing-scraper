import { CheerioHtmlParser } from '../../src/infrastructure/parsers/CheerioHtmlParser';
import { Logger } from '../../src/application/ports/Logger';

describe('CheerioHtmlParser', () => {
  let parser: CheerioHtmlParser;

  beforeEach(() => {
    parser = new CheerioHtmlParser();
  });

  describe('extractCouponInfo', () => {
    it('extracts coupon from anchor with /promotion/psp/ in href (pattern 1)', () => {
      const html = `
        <html><body>
          <a href="/promotion/psp/ADH0UL09UHBVR?redirectAsin=B0TEST123&redirectMerchantId=M123">
            Cupom 10%
          </a>
        </body></html>
      `;
      const result = parser.extractCouponInfo(html);
      expect(result).toEqual({
        promotionId: 'ADH0UL09UHBVR',
        redirectAsin: 'B0TEST123',
        redirectMerchantId: 'M123',
        promotionMerchantId: 'M123',
      });
    });

    it('extracts coupon from element with coupon id wrapping anchor (pattern 2)', () => {
      const html = `
        <html><body>
          <div id="couponBadgeRegularVpc">
            <a href="/promotion/psp/PROMO456?redirectAsin=B0ASIN456&redirectMerchantId=MERCH456">
              Apply coupon
            </a>
          </div>
        </body></html>
      `;
      const result = parser.extractCouponInfo(html);
      expect(result).toEqual({
        promotionId: 'PROMO456',
        redirectAsin: 'B0ASIN456',
        redirectMerchantId: 'MERCH456',
        promotionMerchantId: 'MERCH456',
      });
    });

    it('extracts coupon from anchor with coupon keyword text (pattern 3)', () => {
      const html = `
        <html><body>
          <a href="/promotion/psp/KEYWORD789?redirectAsin=B0KEY789&redirectMerchantId=MK789">
            Clique para aplicar o cupom
          </a>
        </body></html>
      `;
      const result = parser.extractCouponInfo(html);
      expect(result).toEqual({
        promotionId: 'KEYWORD789',
        redirectAsin: 'B0KEY789',
        redirectMerchantId: 'MK789',
        promotionMerchantId: 'MK789',
      });
    });

    it('returns null when no coupon link exists', () => {
      const html = '<html><body><p>No coupon here</p></body></html>';
      expect(parser.extractCouponInfo(html)).toBeNull();
    });

    it('returns null when anchor has no /promotion/psp/ in href', () => {
      const html = `
        <html><body>
          <div id="couponBadgeRegularVpc">
            <a href="/deals/lightning">Some deal</a>
          </div>
        </body></html>
      `;
      expect(parser.extractCouponInfo(html)).toBeNull();
    });

    it('handles full absolute URL in href', () => {
      const html = `
        <html><body>
          <a href="https://www.amazon.com.br/promotion/psp/FULLURL?redirectAsin=B0FULL&redirectMerchantId=MFULL">
            cupom
          </a>
        </body></html>
      `;
      const result = parser.extractCouponInfo(html);
      expect(result).toEqual({
        promotionId: 'FULLURL',
        redirectAsin: 'B0FULL',
        redirectMerchantId: 'MFULL',
        promotionMerchantId: 'MFULL',
      });
    });

    it('returns null when promotion path is malformed', () => {
      const html = `
        <html><body>
          <a href="/promotion/psp/?redirectAsin=B0NONE">cupom</a>
        </body></html>
      `;
      expect(parser.extractCouponInfo(html)).toBeNull();
    });

    it('returns null when coupon id element has anchor without /promotion/psp/ href', () => {
      const html = `
        <html><body>
          <div id="couponWidget">
            <a href="/deals/other-page">not a coupon link</a>
          </div>
        </body></html>
      `;
      expect(parser.extractCouponInfo(html)).toBeNull();
    });

    it('returns null when keyword anchor has no /promotion/psp/ href', () => {
      const html = `
        <html><body>
          <a href="/some/other/path">Clique para aplicar o cupom</a>
        </body></html>
      `;
      expect(parser.extractCouponInfo(html)).toBeNull();
    });

    it('extracts from pattern 2 with Coupon (capital C) in id', () => {
      const html = `
        <html><body>
          <div id="vpcCouponWidget">
            <a href="/promotion/psp/CAPC?redirectAsin=B0C&redirectMerchantId=MC">Apply</a>
          </div>
        </body></html>
      `;
      const result = parser.extractCouponInfo(html);
      expect(result).toEqual({
        promotionId: 'CAPC',
        redirectAsin: 'B0C',
        redirectMerchantId: 'MC',
        promotionMerchantId: 'MC',
      });
    });

    it('returns null when path has psp but no id after it', () => {
      const html = `
        <html><body>
          <a href="/promotion/psp/">cupom</a>
        </body></html>
      `;
      expect(parser.extractCouponInfo(html)).toBeNull();
    });
  });

  describe('extractCsrfToken', () => {
    it('prioritizes token inside productInfoListParam block (strategy 1)', () => {
      const html = `
        <html><body>
          <script>
            var other = { "anti-csrftoken-a2z" : "WRONG_TOKEN" };
            let productInfoListParam = {
              "promotionId": "PROMO",
              "anti-csrftoken-a2z": 'CORRECT_TOKEN_FROM_PSP'
            };
          </script>
        </body></html>
      `;
      expect(parser.extractCsrfToken(html)).toBe('CORRECT_TOKEN_FROM_PSP');
    });

    it('extracts token from hidden input when no productInfoListParam (strategy 2)', () => {
      const html = `
        <html><body>
          <form>
            <input type="hidden" name="anti-csrftoken-a2z" value="TOKEN_FROM_INPUT">
          </form>
        </body></html>
      `;
      expect(parser.extractCsrfToken(html)).toBe('TOKEN_FROM_INPUT');
    });

    it('extracts token from JSON-like assignment with double quotes (strategy 3)', () => {
      const html = `
        <html><body>
          <script>var config = { "anti-csrftoken-a2z" : "TOKEN_FROM_JSON" };</script>
        </body></html>
      `;
      expect(parser.extractCsrfToken(html)).toBe('TOKEN_FROM_JSON');
    });

    it('extracts token from JSON-like assignment with single quotes (strategy 3)', () => {
      const html = `
        <html><body>
          <script>var config = { "anti-csrftoken-a2z" : 'TOKEN_SINGLE_QUOTE' };</script>
        </body></html>
      `;
      expect(parser.extractCsrfToken(html)).toBe('TOKEN_SINGLE_QUOTE');
    });

    it('extracts token from JS-like assignment (strategy 4)', () => {
      const html = `
        <html><body>
          <script>anti-csrftoken-a2z = "TOKEN_FROM_JS";</script>
        </body></html>
      `;
      expect(parser.extractCsrfToken(html)).toBe('TOKEN_FROM_JS');
    });

    it('prefers productInfoListParam over all others', () => {
      const html = `
        <html><body>
          <input type="hidden" name="anti-csrftoken-a2z" value="INPUT_LOSES">
          <script>
            var x = { "anti-csrftoken-a2z" : "JSON_LOSES" };
            let productInfoListParam = {
              "anti-csrftoken-a2z": 'PSP_WINS'
            };
          </script>
        </body></html>
      `;
      expect(parser.extractCsrfToken(html)).toBe('PSP_WINS');
    });

    it('falls back to hidden input when no productInfoListParam', () => {
      const html = `
        <html><body>
          <input type="hidden" name="anti-csrftoken-a2z" value="INPUT_WINS">
          <script>
            var x = { "anti-csrftoken-a2z" : "JSON_LOSES" };
          </script>
        </body></html>
      `;
      expect(parser.extractCsrfToken(html)).toBe('INPUT_WINS');
    });

    it('falls back to JSON when input is missing', () => {
      const html = `
        <html><body>
          <script>
            var x = { "anti-csrftoken-a2z" : "JSON_FALLBACK" };
            anti-csrftoken-a2z = "JS_FALLBACK";
          </script>
        </body></html>
      `;
      expect(parser.extractCsrfToken(html)).toBe('JSON_FALLBACK');
    });

    it('returns null when no token exists', () => {
      const html = '<html><body><p>No token</p></body></html>';
      expect(parser.extractCsrfToken(html)).toBeNull();
    });
  });

  describe('extractProductInfo', () => {
    function createLogger(): jest.Mocked<Logger> {
      return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    }

    function buildHtml(parts: {
      availability?: string;
      preorderButton?: boolean;
      landingImage?: { src: string; hiRes?: string };
      merchantId?: string;
      format?: { name: string; selected?: boolean }[];
      publisher?: string;
      contributors?: { name: string; role?: string }[];
      productGroupId?: string;
      price?: string;
      originalPrice?: string;
      prime?: boolean;
      rating?: string;
      reviewCount?: string;
    }): string {
      const availability = parts.availability
        ? `<div id="availability"><span class="a-size-medium a-color-success primary-availability-message">${parts.availability}</span></div>`
        : '';

      const preorderBtn = parts.preorderButton
        ? '<span class="a-button a-button-preorder"><span class="a-button-text">Comprar na pré-venda</span></span>'
        : '';

      const img = parts.landingImage
        ? `<img id="landingImage" src="${parts.landingImage.src}"${parts.landingImage.hiRes ? ` data-old-hires="${parts.landingImage.hiRes}"` : ''} />`
        : '';

      const merchant = parts.merchantId
        ? `<input type="hidden" id="merchantID" name="merchantID" value="${parts.merchantId}">`
        : '';

      const swatches = parts.format
        ? `<div id="tmmSwatches">${parts.format
            .map(
              (f) =>
                `<div class="swatchElement${f.selected ? ' selected' : ''} celwidget"><span aria-label="${f.name} Formato:">${f.name}</span></div>`,
            )
            .join('')}</div>`
        : '';

      const pub = parts.publisher
        ? `<div id="rpi-attribute-book_details-publisher"><div class="rpi-attribute-value"><span>${parts.publisher}</span></div></div>`
        : '';

      const byline = parts.contributors
        ? `<div id="bylineInfo">${parts.contributors
            .map(
              (c) =>
                `<span class="author"><a class="a-link-normal" href="#">${c.name}</a>${c.role ? `<span class="contribution"><span class="a-color-secondary">(${c.role})</span></span>` : ''}</span>`,
            )
            .join('')}</div>`
        : '';

      const pgScript = parts.productGroupId
        ? `<script>var obj = {"productGroupID":"${parts.productGroupId}"};</script>`
        : '';

      const priceHtml = parts.price
        ? `<div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">${parts.price}</span></span></div>`
        : '';

      const originalPriceHtml = parts.originalPrice
        ? `<span class="a-price a-text-price"><span class="a-offscreen">${parts.originalPrice}</span></span>`
        : '';

      const primeHtml = parts.prime
        ? '<i class="a-icon a-icon-prime"></i>'
        : '';

      const ratingHtml = parts.rating
        ? `<span data-hook="rating-out-of-text">${parts.rating}</span>`
        : '';

      const reviewCountHtml = parts.reviewCount
        ? `<span id="acrCustomerReviewText">${parts.reviewCount}</span>`
        : '';

      return `<html><body>
        <span id="productTitle">Test Product</span>
        ${priceHtml}${originalPriceHtml}${primeHtml}${ratingHtml}${reviewCountHtml}
        ${availability}${preorderBtn}${img}${merchant}${swatches}${pub}${byline}${pgScript}
      </body></html>`;
    }

    describe('price', () => {
      it('extracts current price from #corePrice_feature_div', () => {
        const html = buildHtml({ price: 'R$ 49,90' });
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.price).toBe('R$ 49,90');
      });

      it('returns empty string when no price selector matches', () => {
        const html = buildHtml({});
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.price).toBe('');
      });

      it('extracts original price from .a-price.a-text-price', () => {
        const html = buildHtml({ price: 'R$ 39,90', originalPrice: 'R$ 59,90' });
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.originalPrice).toBe('R$ 59,90');
      });

      it('ignores originalPrice when it equals current price', () => {
        const html = buildHtml({ price: 'R$ 39,90', originalPrice: 'R$ 39,90' });
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.originalPrice).toBe('');
      });

      it('returns empty originalPrice when section is absent', () => {
        const html = buildHtml({ price: 'R$ 39,90' });
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.originalPrice).toBe('');
      });
    });

    describe('prime', () => {
      it('returns true when .a-icon-prime is present', () => {
        const html = buildHtml({ prime: true });
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.prime).toBe(true);
      });

      it('returns false when no prime indicator exists', () => {
        const html = buildHtml({});
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.prime).toBe(false);
      });
    });

    describe('rating and reviewCount', () => {
      it('extracts rating from data-hook rating text', () => {
        const html = buildHtml({ rating: '4,5 de 5 estrelas' });
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.rating).toBe(4.5);
      });

      it('returns 0 rating when no rating element exists', () => {
        const html = buildHtml({});
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.rating).toBe(0);
      });

      it('extracts reviewCount from #acrCustomerReviewText', () => {
        const html = buildHtml({ reviewCount: '1.234 avaliações' });
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.reviewCount).toBe(1234);
      });

      it('returns 0 reviewCount when no review element exists', () => {
        const html = buildHtml({});
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.reviewCount).toBe(0);
      });
    });

    describe('availability — inStock / isPreOrder', () => {
      it('returns inStock: true when availability text is "Em estoque"', () => {
        const html = buildHtml({ availability: ' Em estoque ' });
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.inStock).toBe(true);
        expect(result.isPreOrder).toBe(false);
      });

      it('returns isPreOrder: true when .a-button-preorder is present', () => {
        const html = buildHtml({
          availability: ' Este produto ainda não foi lançado. ',
          preorderButton: true,
        });
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.inStock).toBe(false);
        expect(result.isPreOrder).toBe(true);
      });

      it('returns isPreOrder: true when availability text contains "pré-venda"', () => {
        const html = buildHtml({
          availability: 'Reserve o seu na pré-venda.',
        });
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.inStock).toBe(false);
        expect(result.isPreOrder).toBe(true);
      });

      it('returns isPreOrder: true when availability text contains "não foi lançado"', () => {
        const html = buildHtml({
          availability: 'Este produto ainda não foi lançado.',
        });
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.isPreOrder).toBe(true);
      });

      it('warns on unknown availability text when logger is provided', () => {
        const logger = createLogger();
        const html = buildHtml({ availability: 'Texto desconhecido de disponibilidade' });
        parser.extractProductInfo(html, 'B0TEST', 'https://example.com', logger);
        expect(logger.warn).toHaveBeenCalledWith('Unknown availability text', {
          text: 'Texto desconhecido de disponibilidade',
        });
      });

      it('does not warn when logger is not provided', () => {
        const html = buildHtml({ availability: 'Unknown text' });
        expect(() =>
          parser.extractProductInfo(html, 'B0TEST', 'https://example.com'),
        ).not.toThrow();
      });

      it('returns inStock: false and isPreOrder: false when availability section is missing', () => {
        const html = buildHtml({});
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.inStock).toBe(false);
        expect(result.isPreOrder).toBe(false);
      });
    });

    describe('imageUrl', () => {
      it('prefers data-old-hires over src', () => {
        const html = buildHtml({
          landingImage: {
            src: 'https://example.com/small.jpg',
            hiRes: 'https://example.com/large.jpg',
          },
        });
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.imageUrl).toBe('https://example.com/large.jpg');
      });

      it('falls back to src when data-old-hires is absent', () => {
        const html = buildHtml({
          landingImage: { src: 'https://example.com/small.jpg' },
        });
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.imageUrl).toBe('https://example.com/small.jpg');
      });

      it('returns undefined when #landingImage is absent', () => {
        const html = buildHtml({});
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.imageUrl).toBeUndefined();
      });
    });

    describe('offerId', () => {
      it('extracts merchantID from hidden input', () => {
        const html = buildHtml({ merchantId: 'A1ZZFT5FULY4LN' });
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.offerId).toBe('A1ZZFT5FULY4LN');
      });

      it('returns undefined when merchantID is absent', () => {
        const html = buildHtml({});
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.offerId).toBeUndefined();
      });
    });

    describe('format', () => {
      it('extracts from selected swatch aria-label', () => {
        const html = buildHtml({
          format: [
            { name: 'Kindle', selected: false },
            { name: 'Capa dura', selected: true },
          ],
        });
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.format).toBe('Capa dura');
      });

      it('returns undefined when no swatch is selected', () => {
        const html = buildHtml({
          format: [{ name: 'Kindle', selected: false }],
        });
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.format).toBeUndefined();
      });

      it('returns undefined when swatch section is absent', () => {
        const html = buildHtml({});
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.format).toBeUndefined();
      });
    });

    describe('publisher', () => {
      it('extracts publisher from rpi-attribute carousel', () => {
        const html = buildHtml({ publisher: 'Intrínseca' });
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.publisher).toBe('Intrínseca');
      });

      it('returns undefined when publisher section is absent', () => {
        const html = buildHtml({});
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.publisher).toBeUndefined();
      });
    });

    describe('contributors', () => {
      it('extracts contributors with roles', () => {
        const html = buildHtml({
          contributors: [
            { name: 'SenLinYu', role: 'Autor' },
            { name: 'Helen Pandolfi', role: 'Tradutor' },
          ],
        });
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.contributors).toEqual([
          'SenLinYu (Autor)',
          'Helen Pandolfi (Tradutor)',
        ]);
      });

      it('extracts contributor name without role', () => {
        const html = buildHtml({
          contributors: [{ name: 'Solo Author' }],
        });
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.contributors).toEqual(['Solo Author']);
      });

      it('skips contributors with empty name', () => {
        const html = buildHtml({
          contributors: [{ name: '', role: 'Autor' }],
        });
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.contributors).toEqual([]);
      });

      it('returns empty array when bylineInfo is absent', () => {
        const html = buildHtml({});
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.contributors).toEqual([]);
      });
    });

    describe('productGroup', () => {
      it('extracts productGroupID from script block', () => {
        const html = buildHtml({ productGroupId: 'book_display_on_website' });
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.productGroup).toBe('book_display_on_website');
      });

      it('returns undefined when productGroupID is absent', () => {
        const html = buildHtml({});
        const result = parser.extractProductInfo(html, 'B0TEST', 'https://example.com');
        expect(result.productGroup).toBeUndefined();
      });
    });

    it('extracts all new fields together from a full product page', () => {
      const html = buildHtml({
        availability: ' Em estoque ',
        landingImage: {
          src: 'https://example.com/sm.jpg',
          hiRes: 'https://example.com/lg.jpg',
        },
        merchantId: 'A1ZZFT5FULY4LN',
        format: [{ name: 'Capa Comum', selected: true }],
        publisher: 'PANINI (CT)',
        contributors: [{ name: 'Aaron: Jason', role: 'Autor' }],
        productGroupId: 'book_display_on_website',
      });

      const result = parser.extractProductInfo(html, 'B0FULL', 'https://example.com/dp/B0FULL');

      expect(result).toMatchObject({
        asin: 'B0FULL',
        title: 'Test Product',
        inStock: true,
        isPreOrder: false,
        imageUrl: 'https://example.com/lg.jpg',
        offerId: 'A1ZZFT5FULY4LN',
        format: 'Capa Comum',
        publisher: 'PANINI (CT)',
        contributors: ['Aaron: Jason (Autor)'],
        productGroup: 'book_display_on_website',
      });
    });
  });

  describe('extractCouponInfo — edge cases for early-exit branches', () => {
    it('pattern 1 finds first matching anchor even with multiple anchors', () => {
      const html = `
        <html><body>
          <a href="/promotion/psp/FIRST?redirectAsin=A1&redirectMerchantId=M1">cupom 1</a>
          <a href="/promotion/psp/SECOND?redirectAsin=A2&redirectMerchantId=M2">cupom 2</a>
        </body></html>
      `;
      const result = parser.extractCouponInfo(html);
      expect(result?.promotionId).toBe('FIRST');
    });

    it('pattern 3 finds coupon keyword anchor with mixed text', () => {
      const html = `
        <html><body>
          <a href="/some/other">random</a>
          <a href="/promotion/psp/KWORD?redirectAsin=AK&redirectMerchantId=MK">Aplique o coupon agora</a>
        </body></html>
      `;
      const result = parser.extractCouponInfo(html);
      expect(result?.promotionId).toBe('KWORD');
    });
  });
});
