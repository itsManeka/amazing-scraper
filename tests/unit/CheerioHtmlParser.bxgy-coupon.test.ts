import * as fs from 'fs';
import * as path from 'path';
import { CheerioHtmlParser } from '../../src/infrastructure/parsers/CheerioHtmlParser';

describe('CheerioHtmlParser — BXGY (buy-x-get-y) coupons', () => {
  let parser: CheerioHtmlParser;
  let bxgyProductPageHtml: string;
  let bxgyPspPageHtml: string;
  let productPageWithCouponHtml: string;
  let productWithIndividualCouponHtml: string;

  beforeAll(() => {
    const fixturesDir = path.join(__dirname, '..', 'fixtures');
    bxgyProductPageHtml = fs.readFileSync(
      path.join(fixturesDir, 'coupons/bxgy/product-page.html'),
      'utf-8',
    );
    bxgyPspPageHtml = fs.readFileSync(
      path.join(fixturesDir, 'coupons/bxgy/psp-page.html'),
      'utf-8',
    );
    productPageWithCouponHtml = fs.readFileSync(
      path.join(fixturesDir, 'product-page-with-coupon.html'),
      'utf-8',
    );
    productWithIndividualCouponHtml = fs.readFileSync(
      path.join(fixturesDir, 'product-with-individual-coupon.html'),
      'utf-8',
    );
  });

  beforeEach(() => {
    parser = new CheerioHtmlParser();
  });

  describe('[T3.1] BXGY detected as CouponInfo PSP-compatible', () => {
    it('extracts promotionId from BXGY link', () => {
      const result = parser.extractCouponInfo(bxgyProductPageHtml);
      expect(result).not.toBeNull();
      expect(result!.promotionId).toBe('A3TBV928F3J7NX');
    });

    it('extracts redirectAsin from BXGY link query params', () => {
      const result = parser.extractCouponInfo(bxgyProductPageHtml);
      expect(result).not.toBeNull();
      expect(result!.redirectAsin).toBe('B01MZCQ0YX');
    });

    it('extracts redirectMerchantId from BXGY link query params', () => {
      const result = parser.extractCouponInfo(bxgyProductPageHtml);
      expect(result).not.toBeNull();
      expect(result!.redirectMerchantId).toBe('A2EB9PYM83FCP9');
    });

    it('sets promotionMerchantId equal to redirectMerchantId', () => {
      const result = parser.extractCouponInfo(bxgyProductPageHtml);
      expect(result).not.toBeNull();
      expect(result!.promotionMerchantId).toBe('A2EB9PYM83FCP9');
      expect(result!.promotionMerchantId).toBe(result!.redirectMerchantId);
    });

    it('sets couponCode to null for BXGY', () => {
      const result = parser.extractCouponInfo(bxgyProductPageHtml);
      expect(result).not.toBeNull();
      expect(result!.couponCode).toBeNull();
    });

    it('returns full CouponInfo object with all expected fields', () => {
      const result = parser.extractCouponInfo(bxgyProductPageHtml);
      expect(result).toEqual({
        promotionId: 'A3TBV928F3J7NX',
        redirectAsin: 'B01MZCQ0YX',
        redirectMerchantId: 'A2EB9PYM83FCP9',
        promotionMerchantId: 'A2EB9PYM83FCP9',
        couponCode: null,
      });
    });
  });

  describe('[T3.2] Guard F17/F20 — individual does not override BXGY', () => {
    it('extractIndividualCouponInfo returns null when BXGY is detected', () => {
      // The guard in extractIndividualCouponInfo checks if extractCouponInfo is non-null
      // and returns null to prioritise PSP coupons.
      const result = parser.extractIndividualCouponInfo(bxgyProductPageHtml);
      expect(result).toBeNull();
    });
  });

  describe('[T3.3] Regression — pure individual coupon stays individual', () => {
    it('extractCouponInfo returns null for pure individual coupon', () => {
      const result = parser.extractCouponInfo(productWithIndividualCouponHtml);
      expect(result).toBeNull();
    });

    it('extractIndividualCouponInfo returns non-null IndividualCouponInfo for pure individual coupon', () => {
      const result = parser.extractIndividualCouponInfo(productWithIndividualCouponHtml);
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('promotionId');
      expect(result).toHaveProperty('couponCode');
      expect(result).toHaveProperty('discountText');
    });
  });

  describe('[T3.4] Regression — classic PSP coupon (anchor /promotion/psp/ direct)', () => {
    it('extractCouponInfo returns same promotionId as today for classic PSP coupon', () => {
      const result = parser.extractCouponInfo(productPageWithCouponHtml);
      expect(result).not.toBeNull();
      expect(result!.promotionId).toBe('A3VORWOZYX3I4M');
    });

    it('returns CouponInfo with redirectAsin defined', () => {
      const result = parser.extractCouponInfo(productPageWithCouponHtml);
      expect(result).not.toBeNull();
      expect(result!.redirectAsin).toBeDefined();
    });
  });

  describe('[T3.5] Metadata extraction from BXGY PSP page', () => {
    it('extracts title normalised (nbsp → space) from #promotionTitle', () => {
      const metadata = parser.extractCouponMetadata(bxgyPspPageHtml);
      expect(metadata.title).toBe('Economize R$ 15 em 2 itens');
    });

    it('extracts expiration date normalised to dd/MM/yyyy from range "De ... até ..."', () => {
      const metadata = parser.extractCouponMetadata(bxgyPspPageHtml);
      expect(metadata.expiresAt).toBe('30/04/2026');
    });

    it('extracts description from #promotionSchedule', () => {
      const metadata = parser.extractCouponMetadata(bxgyPspPageHtml);
      expect(metadata.description).not.toBeNull();
      expect(metadata.description).toContain('sábado 14 de fevereiro');
      expect(metadata.description).toContain('30 de abril');
    });

    it('extractCsrfToken returns non-empty token (pre-requisite for ExtractCouponProducts)', () => {
      const token = parser.extractCsrfToken(bxgyPspPageHtml);
      expect(token).not.toBeNull();
      expect(token).not.toBe('');
      expect(typeof token).toBe('string');
    });
  });
});
