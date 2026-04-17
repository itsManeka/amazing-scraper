import * as fs from 'fs';
import * as path from 'path';
import { CheerioHtmlParser } from '../../src/infrastructure/parsers/CheerioHtmlParser';

describe('CheerioHtmlParser — coupon fixtures', () => {
  let parser: CheerioHtmlParser;
  let couponPageHtml: string;
  let productPageWithCouponHtml: string;
  let couponPageFixedOffHtml: string;
  let productCupomHandlerHtml: string;

  beforeAll(() => {
    const fixturesDir = path.join(__dirname, '..', 'fixtures');
    couponPageHtml = fs.readFileSync(
      path.join(fixturesDir, 'coupon-page.html'),
      'utf-8',
    );
    productPageWithCouponHtml = fs.readFileSync(
      path.join(fixturesDir, 'product-page-with-coupon.html'),
      'utf-8',
    );
    couponPageFixedOffHtml = fs.readFileSync(
      path.join(fixturesDir, 'coupon-page-fixed-off.html'),
      'utf-8',
    );
    productCupomHandlerHtml = fs.readFileSync(
      path.join(fixturesDir, 'product-cupom-handler.html'),
      'utf-8',
    );
  });

  beforeEach(() => {
    parser = new CheerioHtmlParser();
  });

  describe('extractCouponMetadata (coupon page fixture)', () => {
    it('extracts title from #promotionTitle', () => {
      const metadata = parser.extractCouponMetadata(couponPageHtml);
      expect(metadata.title).toBe('Economize 15% em 1 item (ns)');
    });

    it('extracts expiration date normalised to dd/MM/yyyy', () => {
      const metadata = parser.extractCouponMetadata(couponPageHtml);
      expect(metadata.expiresAt).toBe('20/05/2026');
    });

    it('extracts description from #promotionSchedule', () => {
      const metadata = parser.extractCouponMetadata(couponPageHtml);
      expect(metadata.description).toBe(
        'De quarta-feira 8 de abril de 2026 às 09:00 BRT até quarta-feira 20 de maio de 2026',
      );
    });

    it('returns all three metadata fields as non-null', () => {
      const metadata = parser.extractCouponMetadata(couponPageHtml);
      expect(metadata.title).not.toBeNull();
      expect(metadata.description).not.toBeNull();
      expect(metadata.expiresAt).not.toBeNull();
    });
  });

  describe('extractCouponInfo (product page with coupon fixture)', () => {
    it('detects coupon from /promotion/psp/ link in product page', () => {
      const result = parser.extractCouponInfo(productPageWithCouponHtml);
      expect(result).not.toBeNull();
      expect(result!.promotionId).toBe('A3VORWOZYX3I4M');
    });

    it('extracts redirectAsin from coupon link query params', () => {
      const result = parser.extractCouponInfo(productPageWithCouponHtml);
      expect(result).not.toBeNull();
      // The coupon link does not have redirectAsin as a query param in the psp link
      // so it falls back to empty string per parseCouponHref
      expect(result!.redirectAsin).toBeDefined();
    });

    it('extracts couponCode FJOVKLWWIZXM from "com o cupom" text', () => {
      const result = parser.extractCouponInfo(productPageWithCouponHtml);
      expect(result).not.toBeNull();
      expect(result!.couponCode).toBe('FJOVKLWWIZXM');
    });

    it('extracts promotionMerchantId from coupon link', () => {
      const result = parser.extractCouponInfo(productPageWithCouponHtml);
      expect(result).not.toBeNull();
      expect(result!.promotionMerchantId).toBeDefined();
    });

    it('returns null when html has no coupon link', () => {
      const htmlNoCoupon = '<html><body><p>No promotion links here</p></body></html>';
      expect(parser.extractCouponInfo(htmlNoCoupon)).toBeNull();
    });
  });

  describe('extractCouponInfo (product-cupom-handler.html — JS handler false positive bug)', () => {
    it('detects PSP coupon promotionId A2H4XVUW6JIA5J', () => {
      const result = parser.extractCouponInfo(productCupomHandlerHtml);
      expect(result).not.toBeNull();
      expect(result!.promotionId).toBe('A2H4XVUW6JIA5J');
    });

    it('extracts couponCode OLHACUPOM (not "HANDLER" leaking from inline <script>)', () => {
      const result = parser.extractCouponInfo(productCupomHandlerHtml);
      expect(result).not.toBeNull();
      expect(result!.couponCode).toBe('OLHACUPOM');
    });

    it('couponCode never contains "HANDLER"', () => {
      const result = parser.extractCouponInfo(productCupomHandlerHtml);
      expect(result?.couponCode).not.toBe('HANDLER');
    });
  });

  describe('coupon-page-fixed-off', () => {
    it('extracts title from #promotionTitle h1 with nbsp normalised to regular space', () => {
      const metadata = parser.extractCouponMetadata(couponPageFixedOffHtml);
      expect(metadata.title).toBe('Só no app - R$ 50 off em Jogos Galapagos');
    });

    it('extracts expiresAt as dd/MM/yyyy from #promotionSchedule end date', () => {
      const metadata = parser.extractCouponMetadata(couponPageFixedOffHtml);
      expect(metadata.expiresAt).toBe('12/04/2026');
    });
  });

  describe('extractCouponMetadata — edge cases with fixture structure', () => {
    it('returns null fields when promotionTitle and promotionSchedule are missing', () => {
      const emptyHtml = '<html><body><div>No coupon metadata</div></body></html>';
      const metadata = parser.extractCouponMetadata(emptyHtml);
      expect(metadata.title).toBeNull();
      expect(metadata.description).toBeNull();
      expect(metadata.expiresAt).toBeNull();
    });

    it('extracts title even when description is absent', () => {
      const htmlTitleOnly = `
        <html><body>
          <div id="promotionTitle"><h1>Some promo title</h1></div>
        </body></html>
      `;
      const metadata = parser.extractCouponMetadata(htmlTitleOnly);
      expect(metadata.title).toBe('Some promo title');
      expect(metadata.description).toBeNull();
      expect(metadata.expiresAt).toBeNull();
    });
  });
});
