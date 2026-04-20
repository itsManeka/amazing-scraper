import * as fs from 'fs';
import * as path from 'path';
import { CheerioHtmlParser } from '../../src/infrastructure/parsers/CheerioHtmlParser';

describe('CheerioHtmlParser — extractIndividualCouponInfo (applicable)', () => {
  let parser: CheerioHtmlParser;
  let coupon03Html: string;
  let coupon04Html: string;
  let coupon04RealHtml: string;
  let productWithIndividualCouponHtml: string;
  let preOrderHtml: string;

  beforeAll(() => {
    const fixturesDir = path.join(__dirname, '..', 'fixtures');
    coupon03Html = fs.readFileSync(
      path.join(fixturesDir, 'coupons', 'applicable', 'product-coupon-03.html'),
      'utf-8',
    );
    coupon04Html = fs.readFileSync(
      path.join(fixturesDir, 'coupons', 'applicable', 'product-coupon-04.html'),
      'utf-8',
    );
    coupon04RealHtml = fs.readFileSync(
      path.join(fixturesDir, 'coupons', 'applicable', 'product-coupon-04-real.html'),
      'utf-8',
    );
    productWithIndividualCouponHtml = fs.readFileSync(
      path.join(fixturesDir, 'product-with-individual-coupon.html'),
      'utf-8',
    );
    preOrderHtml = fs.readFileSync(
      path.join(fixturesDir, 'product-preorder-promo.html'),
      'utf-8',
    );
  });

  beforeEach(() => {
    parser = new CheerioHtmlParser();
  });

  describe('coupon-03 — applicable coupon without "Ver Itens Participantes"', () => {
    it('returns IndividualCouponInfo with promotionId AF12ZU9VE9JOE', () => {
      const result = parser.extractIndividualCouponInfo(coupon03Html);
      expect(result).not.toBeNull();
      expect(result!.promotionId).toBe('AF12ZU9VE9JOE');
    });

    it('returns isApplicable: true for applicable pattern', () => {
      const result = parser.extractIndividualCouponInfo(coupon03Html);
      expect(result).not.toBeNull();
      expect(result!.isApplicable).toBe(true);
    });

    it('extracts discountPercent 10 from "Aplicar cupom de 10%"', () => {
      const result = parser.extractIndividualCouponInfo(coupon03Html);
      expect(result).not.toBeNull();
      expect(result!.discountPercent).toBe(10);
      expect(typeof result!.discountPercent).toBe('number');
    });

    it('returns participatingProductsUrl as null when link is absent', () => {
      const result = parser.extractIndividualCouponInfo(coupon03Html);
      expect(result).not.toBeNull();
      expect(result!.participatingProductsUrl).toBeNull();
    });

    it('returns couponCode as null for applicable coupon', () => {
      const result = parser.extractIndividualCouponInfo(coupon03Html);
      expect(result).not.toBeNull();
      expect(result!.couponCode).toBeNull();
    });

    it('extracts termsUrl containing /promotion/details/popup/AF12ZU9VE9JOE', () => {
      const result = parser.extractIndividualCouponInfo(coupon03Html);
      expect(result).not.toBeNull();
      expect(result!.termsUrl).toContain('/promotion/details/popup/AF12ZU9VE9JOE');
    });

    it('marks with isIndividual: true', () => {
      const result = parser.extractIndividualCouponInfo(coupon03Html);
      expect(result).not.toBeNull();
      expect(result!.isIndividual).toBe(true);
    });
  });

  // product-coupon-04.html is a SYNTHETIC fixture with href="/promotion/applicable/A227SUYAFEZIRF" (unrealistic)
  // used to isolate the applicable coupon detection flow. The real Amazon uses "/promotion/psp/" instead.
  describe('coupon-04 — applicable coupon with "Ver Itens Participantes"', () => {
    it('returns IndividualCouponInfo with promotionId A227SUYAFEZIRF', () => {
      const result = parser.extractIndividualCouponInfo(coupon04Html);
      expect(result).not.toBeNull();
      expect(result!.promotionId).toBe('A227SUYAFEZIRF');
    });

    it('returns isApplicable: true', () => {
      const result = parser.extractIndividualCouponInfo(coupon04Html);
      expect(result).not.toBeNull();
      expect(result!.isApplicable).toBe(true);
    });

    it('extracts discountPercent 15 from "Aplicar cupom de 15%"', () => {
      const result = parser.extractIndividualCouponInfo(coupon04Html);
      expect(result).not.toBeNull();
      expect(result!.discountPercent).toBe(15);
      expect(typeof result!.discountPercent).toBe('number');
    });

    it('extracts participatingProductsUrl from "Ver Itens Participantes" link', () => {
      const result = parser.extractIndividualCouponInfo(coupon04Html);
      expect(result).not.toBeNull();
      expect(result!.participatingProductsUrl).toMatch(/\/promotion\/(applicable|psp)\/A227SUYAFEZIRF/i);
    });

    it('returns couponCode as null for applicable coupon', () => {
      const result = parser.extractIndividualCouponInfo(coupon04Html);
      expect(result).not.toBeNull();
      expect(result!.couponCode).toBeNull();
    });

    it('extracts termsUrl containing /promotion/details/popup/A227SUYAFEZIRF', () => {
      const result = parser.extractIndividualCouponInfo(coupon04Html);
      expect(result).not.toBeNull();
      expect(result!.termsUrl).toContain('/promotion/details/popup/A227SUYAFEZIRF');
    });

    it('marks with isIndividual: true', () => {
      const result = parser.extractIndividualCouponInfo(coupon04Html);
      expect(result).not.toBeNull();
      expect(result!.isIndividual).toBe(true);
    });
  });

  describe('regression — classic individual coupon flow', () => {
    it('preserves backward compatibility: isApplicable absent/undefined for classic flow', () => {
      const result = parser.extractIndividualCouponInfo(productWithIndividualCouponHtml);
      expect(result).not.toBeNull();
      expect(result!.couponCode).toBe('VEMNOAPP');
      expect(result!.isApplicable).toBeUndefined();
    });
  });

  describe('regression — anti-false-positive filter (pre-order filter preserved)', () => {
    it('filters out informative pre-order promo but returns real coupon (product-preorder-promo.html)', () => {
      // This fixture has two promotions:
      // 1. A15UPZCIWH41W4: informative pre-venda (skipped by filter)
      // 2. ATVO4IBO0PTIE: real coupon VEMNOAPP with R$20 discount (returned)
      // Confirms the anti-false-positive filter still works after applicable implementation.
      const result = parser.extractIndividualCouponInfo(preOrderHtml);
      expect(result).not.toBeNull();
      expect(result!.promotionId).toBe('ATVO4IBO0PTIE');
      expect(result!.couponCode).toBe('VEMNOAPP');
      expect(result!.isApplicable).toBeUndefined();
    });
  });

  // product-coupon-04-real.html is the REAL Amazon HTML for the same applicable coupon A227SUYAFEZIRF,
  // with href="/promotion/psp/" (as it appears in production). Used for regression testing the precedence fix.
  describe('regression — precedence: applicable coupon with real /promotion/psp/ link (product-coupon-04-real.html)', () => {
    it('detects applicable coupon despite /promotion/psp/ href in DOM (precedence fix)', () => {
      // CRITICAL BUG FIX: The real Amazon HTML has href="/promotion/psp/A227SUYAFEZIRF" in the "Ver Itens Participantes"
      // link, which previously triggered Pattern 5 of extractCouponInfo and masked the applicable coupon.
      // This test confirms that the precedence check now skips PSP detection when "Aplicar cupom de X%" is present.
      const result = parser.extractIndividualCouponInfo(coupon04RealHtml);
      expect(result).not.toBeNull();
      expect(result!.isApplicable).toBe(true);
      expect(result!.promotionId).toBe('A227SUYAFEZIRF');
      expect(result!.discountPercent).toBe(15);
    });

    it('extracts participatingProductsUrl with /promotion/psp/ href from real HTML', () => {
      const result = parser.extractIndividualCouponInfo(coupon04RealHtml);
      expect(result).not.toBeNull();
      expect(result!.participatingProductsUrl).toMatch(/\/promotion\/psp\/A227SUYAFEZIRF/i);
    });

    it('returns couponCode as null for applicable coupon (not masked by PSP)', () => {
      const result = parser.extractIndividualCouponInfo(coupon04RealHtml);
      expect(result).not.toBeNull();
      expect(result!.couponCode).toBeNull();
    });
  });

});
