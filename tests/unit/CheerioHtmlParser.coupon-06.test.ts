import * as fs from 'fs';
import * as path from 'path';
import { CheerioHtmlParser } from '../../src/infrastructure/parsers/CheerioHtmlParser';

describe('CheerioHtmlParser — coupon-06 (3 simultaneous coupons)', () => {
  let parser: CheerioHtmlParser;
  let coupon06Html: string;

  beforeAll(() => {
    const fixturesDir = path.join(__dirname, '..', 'fixtures', 'coupons');
    coupon06Html = fs.readFileSync(
      path.join(fixturesDir, 'coupon-06-product.html'),
      'utf-8',
    );
  });

  beforeEach(() => {
    parser = new CheerioHtmlParser();
  });

  describe('extractAllCoupons', () => {
    it('returns array of 3 coupons from coupon-06 fixture', () => {
      const coupons = parser.extractAllCoupons(coupon06Html);
      expect(Array.isArray(coupons)).toBe(true);
      expect(coupons).toHaveLength(3);
    });

    it('first coupon is BRINQUEDOS30 (PSP)', () => {
      const coupons = parser.extractAllCoupons(coupon06Html);
      const coupon1 = coupons[0];
      expect(coupon1.promotionId).toBe('A359G0XL8F8HRC');
      expect(coupon1.couponCode).toBe('BRINQUEDOS30');
    });

    it('second coupon is COMPRANOAPP (individual)', () => {
      const coupons = parser.extractAllCoupons(coupon06Html);
      const coupon2 = coupons[1];
      expect(coupon2.promotionId).toBe('AMB0EETS19SS4');
      expect(coupon2.couponCode).toBe('COMPRANOAPP');
    });

    it('third coupon is PUZZLES20 (PSP hybrid)', () => {
      const coupons = parser.extractAllCoupons(coupon06Html);
      const coupon3 = coupons[2];
      expect(coupon3.promotionId).toBe('AQN8RX8K6UGUQ');
      expect(coupon3.couponCode).toBe('PUZZLES20');
    });

    it('zero cross-coupon code leak: codes are distinct', () => {
      const coupons = parser.extractAllCoupons(coupon06Html);
      const codes = coupons.map((c) => c.couponCode);
      // All codes must be present and distinct
      expect(codes).toEqual(['BRINQUEDOS30', 'COMPRANOAPP', 'PUZZLES20']);
      // No code should appear twice
      expect(new Set(codes).size).toBe(codes.length);
    });

    it('no coupon has null couponCode', () => {
      const coupons = parser.extractAllCoupons(coupon06Html);
      coupons.forEach((coupon, index) => {
        expect(coupon.couponCode).not.toBeNull();
        if (coupon.couponCode === null) {
          throw new Error(
            `Coupon at index ${index} (promotionId: ${coupon.promotionId}) has null couponCode`,
          );
        }
      });
    });

    it('all promotionIds are valid and match expected values', () => {
      const coupons = parser.extractAllCoupons(coupon06Html);
      const promotionIds = coupons.map((c) => c.promotionId);
      expect(promotionIds).toEqual([
        'A359G0XL8F8HRC',
        'AMB0EETS19SS4',
        'AQN8RX8K6UGUQ',
      ]);
    });
  });

  describe('backward compatibility: extractCouponInfo (legacy singular)', () => {
    it('still returns first PSP coupon (BRINQUEDOS30)', () => {
      const result = parser.extractCouponInfo(coupon06Html);
      expect(result).not.toBeNull();
      expect(result!.promotionId).toBe('A359G0XL8F8HRC');
      expect(result!.couponCode).toBe('BRINQUEDOS30');
    });

    it('does not return PUZZLES20 (second PSP)', () => {
      const result = parser.extractCouponInfo(coupon06Html);
      expect(result?.promotionId).not.toBe('AQN8RX8K6UGUQ');
    });
  });

  describe('backward compatibility: extractIndividualCouponInfo (legacy singular)', () => {
    it('returns null because PSP is present', () => {
      const result = parser.extractIndividualCouponInfo(coupon06Html);
      expect(result).toBeNull();
    });
  });

  describe('extractProductInfo with couponInfos field (T4 — aditivo Opcao C)', () => {
    it('returns ProductPage with couponInfos array containing 3 coupons', () => {
      const page = parser.extractProductInfo(
        coupon06Html,
        'B09BBB4L2B',
        'https://www.amazon.com.br/Toyster-Quebra-cabe%C3%A7a-Vincent-Estrelada-pe%C3%A7as/dp/B09BBB4L2B',
      );
      expect(page.couponInfos).toBeDefined();
      expect(Array.isArray(page.couponInfos)).toBe(true);
      expect(page.couponInfos).toHaveLength(3);
    });

    it('couponInfos[0] is BRINQUEDOS30 (PSP)', () => {
      const page = parser.extractProductInfo(
        coupon06Html,
        'B09BBB4L2B',
        'https://www.amazon.com.br/Toyster-Quebra-cabe%C3%A7a-Vincent-Estrelada-pe%C3%A7as/dp/B09BBB4L2B',
      );
      expect(page.couponInfos![0].promotionId).toBe('A359G0XL8F8HRC');
      expect(page.couponInfos![0].couponCode).toBe('BRINQUEDOS30');
    });

    it('couponInfos[1] is COMPRANOAPP (individual)', () => {
      const page = parser.extractProductInfo(
        coupon06Html,
        'B09BBB4L2B',
        'https://www.amazon.com.br/Toyster-Quebra-cabe%C3%A7a-Vincent-Estrelada-pe%C3%A7as/dp/B09BBB4L2B',
      );
      expect(page.couponInfos![1].promotionId).toBe('AMB0EETS19SS4');
      expect(page.couponInfos![1].couponCode).toBe('COMPRANOAPP');
    });

    it('couponInfos[2] is PUZZLES20 (PSP hybrid)', () => {
      const page = parser.extractProductInfo(
        coupon06Html,
        'B09BBB4L2B',
        'https://www.amazon.com.br/Toyster-Quebra-cabe%C3%A7a-Vincent-Estrelada-pe%C3%A7as/dp/B09BBB4L2B',
      );
      expect(page.couponInfos![2].promotionId).toBe('AQN8RX8K6UGUQ');
      expect(page.couponInfos![2].couponCode).toBe('PUZZLES20');
    });

    it('preserves backward-compat: couponInfo singular is first PSP from array', () => {
      const page = parser.extractProductInfo(
        coupon06Html,
        'B09BBB4L2B',
        'https://www.amazon.com.br/Toyster-Quebra-cabe%C3%A7a-Vincent-Estrelada-pe%C3%A7as/dp/B09BBB4L2B',
      );
      // couponInfo should be the first PSP (BRINQUEDOS30)
      expect(page.couponInfo).not.toBeNull();
      expect(page.couponInfo!.promotionId).toBe('A359G0XL8F8HRC');
      expect(page.couponInfo!.couponCode).toBe('BRINQUEDOS30');
    });

    it('sets hasCoupon=true when couponInfos is not empty', () => {
      const page = parser.extractProductInfo(
        coupon06Html,
        'B09BBB4L2B',
        'https://www.amazon.com.br/Toyster-Quebra-cabe%C3%A7a-Vincent-Estrelada-pe%C3%A7as/dp/B09BBB4L2B',
      );
      expect(page.hasCoupon).toBe(true);
    });

    it('sets hasCoupon=true for individual-only scenario (couponInfo=null but couponInfos present)', () => {
      // Regression test for Critico #1: hasCoupon must reflect presence of ANY coupon
      // Test case: a product with only individual coupons (no PSP).
      // Scenario: extractCouponInfo returns null (no PSP), but extractAllCoupons returns individual(s).
      const htmlOnlyIndividual = `
        <html><body>
          <div id="productTitle">Test Product</div>
          <div class="a-price"><span class="a-offscreen">R$ 50,00</span></div>
          <div id="availability"><span class="primary-availability-message">Em estoque</span></div>
          <div id="merchantID" value="A1ZZFT5FULY4LN"></div>
          <div data-csa-c-owner="PromotionsDiscovery" data-csa-c-item-id="amzn1.asin.B0TEST:amzn1.promotion.INDV0001">
            <span id="promoMessageCXCW">Insira o código GEEK15 e economize 15%</span>
            <label>Economize 15%</label>
          </div>
        </body></html>
      `;
      const page = parser.extractProductInfo(
        htmlOnlyIndividual,
        'B0TEST',
        'https://www.amazon.com.br/dp/B0TEST',
      );
      // PSP coupon (couponInfo) should be null
      expect(page.couponInfo).toBeNull();
      // But individual coupons should be found via extractAllCoupons
      expect(page.couponInfos.length).toBeGreaterThan(0);
      // Most importantly: hasCoupon must reflect the presence of couponInfos
      expect(page.hasCoupon).toBe(true);
    });
  });
});
