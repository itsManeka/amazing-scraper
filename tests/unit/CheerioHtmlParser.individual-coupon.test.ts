import * as fs from 'fs';
import * as path from 'path';
import { CheerioHtmlParser } from '../../src/infrastructure/parsers/CheerioHtmlParser';

describe('CheerioHtmlParser — extractIndividualCouponInfo', () => {
  let parser: CheerioHtmlParser;
  let productWithIndividualCouponHtml: string;
  let productPageWithCouponHtml: string;

  beforeAll(() => {
    const fixturesDir = path.join(__dirname, '..', 'fixtures');
    productWithIndividualCouponHtml = fs.readFileSync(
      path.join(fixturesDir, 'product-with-individual-coupon.html'),
      'utf-8',
    );
    productPageWithCouponHtml = fs.readFileSync(
      path.join(fixturesDir, 'product-page-with-coupon.html'),
      'utf-8',
    );
  });

  beforeEach(() => {
    parser = new CheerioHtmlParser();
  });

  describe('real fixture: product-with-individual-coupon.html', () => {
    it('returns IndividualCouponInfo with promotionId ATVO4IBO0PTIE', () => {
      const result = parser.extractIndividualCouponInfo(productWithIndividualCouponHtml);
      expect(result).not.toBeNull();
      expect(result!.promotionId).toBe('ATVO4IBO0PTIE');
    });

    it('extracts couponCode VEMNOAPP from the inline promo message', () => {
      const result = parser.extractIndividualCouponInfo(productWithIndividualCouponHtml);
      expect(result).not.toBeNull();
      expect(result!.couponCode).toBe('VEMNOAPP');
    });

    it('extracts termsUrl containing /promotion/details/popup/ATVO4IBO0PTIE from data-a-modal JSON', () => {
      const result = parser.extractIndividualCouponInfo(productWithIndividualCouponHtml);
      expect(result).not.toBeNull();
      expect(result!.termsUrl).toContain('/promotion/details/popup/ATVO4IBO0PTIE');
    });

    it('extracts a non-empty description with the coupon message', () => {
      const result = parser.extractIndividualCouponInfo(productWithIndividualCouponHtml);
      expect(result).not.toBeNull();
      expect(result!.description).toBeTruthy();
      expect(result!.description!.toLowerCase()).toContain('vemnoapp');
    });

    it('marks the result with isIndividual: true discriminant', () => {
      const result = parser.extractIndividualCouponInfo(productWithIndividualCouponHtml);
      expect(result).not.toBeNull();
      expect(result!.isIndividual).toBe(true);
    });
  });

  describe('returns null when no individual coupon is present', () => {
    it('returns null for an empty HTML', () => {
      expect(parser.extractIndividualCouponInfo('<html><body></body></html>')).toBeNull();
    });

    it('returns null when container exists without amzn1.promotion id', () => {
      const html = `
        <html><body>
          <div id="promoPriceBlockMessage_feature_div">
            <span data-csa-c-owner="PromotionsDiscovery"
                  data-csa-c-item-id="amzn1.asin.B0TEST:amzn1.bot.NEW"></span>
          </div>
        </body></html>
      `;
      expect(parser.extractIndividualCouponInfo(html)).toBeNull();
    });

    it('returns null when the product has only a PSP-style coupon (prioritises PSP)', () => {
      // product-page-with-coupon fixture has a /promotion/psp/ link — individual
      // coupon detection must skip it.
      const result = parser.extractIndividualCouponInfo(productPageWithCouponHtml);
      expect(result).toBeNull();
    });
  });

  describe('partial / edge cases (inline HTML)', () => {
    it('extracts promotionId and isIndividual when data-a-modal is missing (termsUrl = null)', () => {
      const html = `
        <html><body>
          <div id="promoPriceBlockMessage_feature_div">
            <span data-csa-c-type="item"
                  data-csa-c-item-id="amzn1.asin.B0X:amzn1.promotion.PROMOXYZ123"
                  data-csa-c-owner="PromotionsDiscovery">
              <span id="promoMessageCXCW_x">off.Insira o código ABCDEF na hora do pagamento.</span>
            </span>
          </div>
        </body></html>
      `;
      const result = parser.extractIndividualCouponInfo(html);
      expect(result).not.toBeNull();
      expect(result!.promotionId).toBe('PROMOXYZ123');
      expect(result!.couponCode).toBe('ABCDEF');
      expect(result!.termsUrl).toBeNull();
    });

    it('extracts termsUrl from data-a-modal JSON on inline HTML', () => {
      const html = `
        <html><body>
          <div id="promoPriceBlockMessage_feature_div">
            <span data-csa-c-type="item"
                  data-csa-c-item-id="amzn1.asin.B0Y:amzn1.promotion.PROMOABC"
                  data-csa-c-owner="PromotionsDiscovery">
              <span id="promoMessageCXCW_y">
                off.Insira o código XYZ123 na hora do pagamento.
                <span class="a-declarative" data-action="a-modal"
                      data-a-modal='{"url":"/promotion/details/popup/PROMOABC?ref=x","width":"450","header":"Termos"}'>
                  <a data-selector="cxcwPopoverLink" href="https://www.amazon.com.br/dp/B0Y">Termos</a>
                </span>
              </span>
            </span>
          </div>
        </body></html>
      `;
      const result = parser.extractIndividualCouponInfo(html);
      expect(result).not.toBeNull();
      expect(result!.promotionId).toBe('PROMOABC');
      expect(result!.couponCode).toBe('XYZ123');
      expect(result!.termsUrl).toBe('/promotion/details/popup/PROMOABC?ref=x');
    });

    it('returns couponCode: null when the inline message does not contain a code', () => {
      const html = `
        <html><body>
          <div id="promoPriceBlockMessage_feature_div">
            <span data-csa-c-type="item"
                  data-csa-c-item-id="amzn1.asin.B0Z:amzn1.promotion.PROMONOCODE"
                  data-csa-c-owner="PromotionsDiscovery">
              <span id="promoMessageCXCW_z">Alguma mensagem sem codigo aqui.</span>
            </span>
          </div>
        </body></html>
      `;
      const result = parser.extractIndividualCouponInfo(html);
      expect(result).not.toBeNull();
      expect(result!.couponCode).toBeNull();
    });

    it('handles invalid JSON in data-a-modal gracefully (termsUrl = null)', () => {
      const html = `
        <html><body>
          <div id="promoPriceBlockMessage_feature_div">
            <span data-csa-c-type="item"
                  data-csa-c-item-id="amzn1.asin.B0W:amzn1.promotion.PROMOBAD"
                  data-csa-c-owner="PromotionsDiscovery">
              <span id="promoMessageCXCW_w">off.
                <span class="a-declarative" data-action="a-modal"
                      data-a-modal='not a json'>
                  <a data-selector="cxcwPopoverLink" href="#">Termos</a>
                </span>
              </span>
            </span>
          </div>
        </body></html>
      `;
      const result = parser.extractIndividualCouponInfo(html);
      expect(result).not.toBeNull();
      expect(result!.termsUrl).toBeNull();
    });

    it('returns the first individual coupon when multiple are present', () => {
      const html = `
        <html><body>
          <div id="promoPriceBlockMessage_feature_div">
            <span data-csa-c-type="item"
                  data-csa-c-item-id="amzn1.asin.B0:amzn1.promotion.FIRST000"
                  data-csa-c-owner="PromotionsDiscovery">
              <span id="promoMessageCXCW_1">off.Insira o código FIRST na hora do pagamento.</span>
            </span>
            <span data-csa-c-type="item"
                  data-csa-c-item-id="amzn1.asin.B0:amzn1.promotion.SECOND00"
                  data-csa-c-owner="PromotionsDiscovery">
              <span id="promoMessageCXCW_2">off.Insira o código SECOND na hora do pagamento.</span>
            </span>
          </div>
        </body></html>
      `;
      const result = parser.extractIndividualCouponInfo(html);
      expect(result).not.toBeNull();
      expect(result!.promotionId).toBe('FIRST000');
    });
  });

  describe('integration with extractProductInfo', () => {
    it('populates individualCouponInfo on ProductPage when couponInfo is null', () => {
      const page = parser.extractProductInfo(
        productWithIndividualCouponHtml,
        '6554851836',
        'https://www.amazon.com.br/dp/6554851836',
      );
      expect(page.couponInfo).toBeNull();
      expect(page.individualCouponInfo).not.toBeNull();
      expect(page.individualCouponInfo!.promotionId).toBe('ATVO4IBO0PTIE');
      expect(page.individualCouponInfo!.couponCode).toBe('VEMNOAPP');
    });

    it('leaves individualCouponInfo null when couponInfo (PSP) is present', () => {
      const page = parser.extractProductInfo(
        productPageWithCouponHtml,
        'B0TEST',
        'https://www.amazon.com.br/dp/B0TEST',
      );
      expect(page.couponInfo).not.toBeNull();
      expect(page.individualCouponInfo ?? null).toBeNull();
    });
  });
});
