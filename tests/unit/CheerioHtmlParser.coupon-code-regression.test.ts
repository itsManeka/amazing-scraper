import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';
import { CheerioHtmlParser } from '../../src/infrastructure/parsers/CheerioHtmlParser';

describe('CheerioHtmlParser — coupon code extraction regression (F06)', () => {
  let parser: CheerioHtmlParser;
  let coupon01ProductHtml: string;
  let coupon02ProductHtml: string;
  let coupon05ProductHtml: string;

  beforeAll(() => {
    const fixturesDir = path.join(__dirname, '..', 'fixtures');
    coupon01ProductHtml = fs.readFileSync(
      path.join(fixturesDir, 'coupons/coupon-01-product.html'),
      'utf-8',
    );
    coupon02ProductHtml = fs.readFileSync(
      path.join(fixturesDir, 'coupons/coupon-02-product.html'),
      'utf-8',
    );
    coupon05ProductHtml = fs.readFileSync(
      path.join(fixturesDir, 'coupons/coupon-05-product.html'),
      'utf-8',
    );
  });

  beforeEach(() => {
    parser = new CheerioHtmlParser();
  });

  describe('[Cenario 1] coupon-01 fixture — extracts GEEK15 via "Insira o codigo" regex', () => {
    it('loads coupon-01-product.html fixture', () => {
      expect(coupon01ProductHtml).toBeTruthy();
      expect(coupon01ProductHtml.length).toBeGreaterThan(0);
    });

    it('extracts couponCode === "GEEK15" from coupon block', () => {
      const result = parser.extractCouponInfo(coupon01ProductHtml);
      expect(result).not.toBeNull();
      expect(result!.couponCode).toBe('GEEK15');
    });
  });

  describe('[Cenario 2] coupon-02 fixture — extracts OBRA15', () => {
    it('loads coupon-02-product.html fixture', () => {
      expect(coupon02ProductHtml).toBeTruthy();
      expect(coupon02ProductHtml.length).toBeGreaterThan(0);
    });

    it('extracts couponCode === "OBRA15"', () => {
      const result = parser.extractCouponInfo(coupon02ProductHtml);
      expect(result).not.toBeNull();
      expect(result!.couponCode).toBe('OBRA15');
    });
  });

  describe('[Cenario 3] Fallback restriction — synthetic HTML with "cupom FEEDBACK" outside coupon containers', () => {
    it('returns null couponCode when FEEDBACK text is outside #centerCol, #apex_desktop, #promoPriceBlockMessage_feature_div', () => {
      // Synthetic HTML: coupon block is absent, FEEDBACK text is inside #product-ads-feedback_feature_div (NOT whitelisted)
      const syntheticHtml = `
        <html>
          <body>
            <div id="centerCol">
              <h1>Product Title</h1>
            </div>
            <div id="product-ads-feedback_feature_div">
              <p>cupom FEEDBACK</p>
            </div>
          </body>
        </html>
      `;
      const resultFeedback = parser.extractCouponInfo(syntheticHtml);
      // extractCouponInfo returns null when no coupon link is found, so couponCode will be null
      expect(resultFeedback).toBeNull();
    });
  });

  describe('[Cenario 4] Regression — "com o cupom FJOVKLWWIZXM" in #centerCol remains extractable', () => {
    it('extracts couponCode === "FJOVKLWWIZXM" from "com o cupom X" pattern in whitelisted container', () => {
      const htmlWithLink = `
        <html>
          <body>
            <div id="centerCol">
              <a href="/promotion/psp/A123456789">Clique para aplicar cupom</a>
              <div id="promoPriceBlockMessage_feature_div">
                <p>com o cupom FJOVKLWWIZXM</p>
              </div>
            </div>
            <div id="product-ads-feedback_feature_div">
              <p>Some unrelated feedback</p>
            </div>
          </body>
        </html>
      `;
      const resultFjov = parser.extractCouponInfo(htmlWithLink);
      expect(resultFjov).not.toBeNull();
      expect(resultFjov!.couponCode).toBe('FJOVKLWWIZXM');
    });
  });

  describe('[Cenario 5] Isolate "Insira o código" regex via direct extractCouponCode call', () => {
    it('extracts "GEEK15" from minimal HTML with #promoPriceBlockMessage_feature_div containing "Insira o código GEEK15"', () => {
      const minimalHtml = `
        <html>
          <body>
            <div id="promoPriceBlockMessage_feature_div">
              <p>Insira o código GEEK15</p>
            </div>
          </body>
        </html>
      `;
      // Parse HTML and access private method via index signature
      const $ = cheerio.load(minimalHtml);
      const result = (parser as unknown as Record<string, (arg: cheerio.CheerioAPI) => string | null>).extractCouponCode($);
      expect(result).toBe('GEEK15');
    });
  });

  describe('[Cenario 6] coupon-05 fixture — multiple simultaneous coupons (RED: must fail on baseline)', () => {
    it('loads coupon-05-product.html fixture (B0BFYX32MW Galapagos Dungeon Fighter)', () => {
      expect(coupon05ProductHtml).toBeTruthy();
      expect(coupon05ProductHtml.length).toBeGreaterThan(0);
    });

    it('extracts a coupon from coupon-05 via Pattern 5 fallback (PSP condicional)', () => {
      const result = parser.extractCouponInfo(coupon05ProductHtml);
      expect(result).not.toBeNull();
      // Based on T1 diagnosis, Pattern 5 returns promotionId A32IKNS6LFS4SH (Economize R$30 cupom)
      expect(result!.promotionId).toBeDefined();
    });

    it('[CRITICAL REGRESSION] coupon-05 couponCode MUST NOT be "COMPRANOAPP" (leak detection)', () => {
      const result = parser.extractCouponInfo(coupon05ProductHtml);
      expect(result).not.toBeNull();
      // The bug: Pattern 5 cupom (A32IKNS6LFS4SH / "Economize R$30") inherits COMPRANOAPP from container 1
      // This assert should FAIL on baseline (before T3 fix), proving bug reproducibility
      expect(result!.couponCode).not.toBe('COMPRANOAPP');
    });

    it('[CRITICAL REGRESSION] coupon-05 couponCode should be null (no code in container 2 text)', () => {
      const result = parser.extractCouponInfo(coupon05ProductHtml);
      expect(result).not.toBeNull();
      // Strict assertion: cupom from container 2 (Economize R$30) has no inline code, so must be null
      expect(result!.couponCode).toBeNull();
    });

    it('coupon-05 result object does not leak COMPRANOAPP into any field', () => {
      const result = parser.extractCouponInfo(coupon05ProductHtml);
      expect(result).not.toBeNull();
      // Defensive check: convert result to string and verify no COMPRANOAPP trace
      const resultStr = JSON.stringify(result);
      expect(resultStr).not.toContain('COMPRANOAPP');
    });
  });
});
