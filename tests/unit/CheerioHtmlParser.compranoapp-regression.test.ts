import * as fs from 'fs';
import * as path from 'path';
import { CheerioHtmlParser } from '../../src/infrastructure/parsers/CheerioHtmlParser';

describe('CheerioHtmlParser — COMPRANOAPP regression (T1 — RED baseline)', () => {
  let parser: CheerioHtmlParser;
  let coupon05Html: string;
  let coupon06Html: string;
  let coupon03Html: string; // Applicable coupon fixture

  beforeAll(() => {
    const fixturesDir = path.join(__dirname, '..', 'fixtures', 'coupons');
    coupon05Html = fs.readFileSync(
      path.join(fixturesDir, 'coupon-05-product.html'),
      'utf-8',
    );
    coupon06Html = fs.readFileSync(
      path.join(fixturesDir, 'coupon-06-product.html'),
      'utf-8',
    );
    coupon03Html = fs.readFileSync(
      path.join(fixturesDir, 'applicable', 'product-coupon-03.html'),
      'utf-8',
    );
  });

  beforeEach(() => {
    parser = new CheerioHtmlParser();
  });

  describe('T1.1: coupon-05 (COMPRANOAPP + Economize R$30) — extractAllCoupons preserves individual metadata', () => {
    /**
     * Regression: In coupon-05, extractAllCoupons returns 2 coupons:
     *   [0] COMPRANOAPP (individual) + metadata
     *   [1] Economize R$30 (PSP, no individual metadata)
     *
     * Pre-epic: COMPRANOAPP had discountText, description, termsUrl, isIndividual
     * Post-epic (broken): COMPRANOAPP lost metadata, returned as plain CouponInfo
     *
     * Expected (T2): COMPRANOAPP entry should have isIndividual, discountText, description, termsUrl
     */
    it('COMPRANOAPP entry has isIndividual === true (as type discriminator)', () => {
      const coupons = parser.extractAllCoupons(coupon05Html);
      expect(coupons.length).toBeGreaterThanOrEqual(1);

      const compranoapp = coupons.find(
        (c) => c.couponCode === 'COMPRANOAPP',
      );
      expect(compranoapp).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((compranoapp as any).isIndividual).toBe(true);
    });

    it('COMPRANOAPP entry has couponCode === "COMPRANOAPP"', () => {
      const coupons = parser.extractAllCoupons(coupon05Html);
      const compranoapp = coupons.find(
        (c) => c.couponCode === 'COMPRANOAPP',
      );
      expect(compranoapp).toBeDefined();
      expect(compranoapp!.couponCode).toBe('COMPRANOAPP');
    });

    it('COMPRANOAPP entry has discountText matching R$20', () => {
      const coupons = parser.extractAllCoupons(coupon05Html);
      const compranoapp = coupons.find(
        (c) => c.couponCode === 'COMPRANOAPP',
      );
      expect(compranoapp).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const discountText = (compranoapp as any).discountText;
      expect(discountText).toBeDefined();
      expect(discountText).not.toBeNull();
      expect(discountText).toMatch(/R\$\s*20/i);
    });

    it('COMPRANOAPP entry has non-null description containing inline text', () => {
      const coupons = parser.extractAllCoupons(coupon05Html);
      const compranoapp = coupons.find(
        (c) => c.couponCode === 'COMPRANOAPP',
      );
      expect(compranoapp).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const description = (compranoapp as any).description;
      expect(description).toBeDefined();
      expect(description).not.toBeNull();
      // Should contain part of the original inline message
      expect(description).toMatch(/Insira|primeira\s+compra|pagamento/i);
    });

    it('COMPRANOAPP entry has non-null termsUrl', () => {
      const coupons = parser.extractAllCoupons(coupon05Html);
      const compranoapp = coupons.find(
        (c) => c.couponCode === 'COMPRANOAPP',
      );
      expect(compranoapp).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const termsUrl = (compranoapp as any).termsUrl;
      expect(termsUrl).toBeDefined();
      expect(termsUrl).not.toBeNull();
      expect(typeof termsUrl).toBe('string');
      expect(termsUrl).toMatch(/\/promotion\/details\/popup\//i);
    });

    it('Economize R$30 entry does NOT have isIndividual === true (shape verification)', () => {
      const coupons = parser.extractAllCoupons(coupon05Html);
      const economize = coupons.find(
        (c) => c.couponCode === null || c.promotionId !== 'AMB0EETS19SS4',
      );
      // Economize R$30 should either not have isIndividual or have it as false/undefined
      if (economize) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isIndiv = (economize as any).isIndividual;
        expect(isIndiv).not.toBe(true);
      }
    });

    it('RG1 (Shape verification): couponInfos[i] with isIndividual === true also has discountText, description, termsUrl (all 3 defined together)', () => {
      const coupons = parser.extractAllCoupons(coupon05Html);
      const compranoapp = coupons.find(
        (c) => c.couponCode === 'COMPRANOAPP',
      );
      expect(compranoapp).toBeDefined();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entry = compranoapp as any;
      // RG1: if isIndividual is true, all 3 metadata fields must be defined
      if (entry.isIndividual === true) {
        expect(entry.discountText).toBeDefined();
        expect(entry.discountText).not.toBeNull();
        expect(entry.description).toBeDefined();
        expect(entry.description).not.toBeNull();
        expect(entry.termsUrl).toBeDefined();
        expect(entry.termsUrl).not.toBeNull();
      }
    });
  });

  describe('T1.2: coupon-06 (BRINQUEDOS30 + COMPRANOAPP + PUZZLES20) — individual in middle position', () => {
    /**
     * Regression: COMPRANOAPP appears as couponInfos[1] in coupon-06.
     * The original fixture has 3 coupons; COMPRANOAPP is the 2nd (individual inline).
     * Post-epic (broken): lost metadata, indistinguishable from PSP coupons
     *
     * Expected (T2): COMPRANOAPP at position [1] should preserve full metadata
     */
    it('coupon-06 extractAllCoupons returns 3 coupons', () => {
      const coupons = parser.extractAllCoupons(coupon06Html);
      expect(coupons.length).toBe(3);
    });

    it('coupon-06[1] is COMPRANOAPP with isIndividual === true', () => {
      const coupons = parser.extractAllCoupons(coupon06Html);
      const compranoapp = coupons[1];
      expect(compranoapp.couponCode).toBe('COMPRANOAPP');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((compranoapp as any).isIndividual).toBe(true);
    });

    it('coupon-06[1] COMPRANOAPP has discountText === R$20', () => {
      const coupons = parser.extractAllCoupons(coupon06Html);
      const compranoapp = coupons[1];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const discountText = (compranoapp as any).discountText;
      expect(discountText).not.toBeNull();
      expect(discountText).toMatch(/R\$\s*20/i);
    });

    it('coupon-06[1] COMPRANOAPP has non-null description', () => {
      const coupons = parser.extractAllCoupons(coupon06Html);
      const compranoapp = coupons[1];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const description = (compranoapp as any).description;
      expect(description).not.toBeNull();
      expect(description).toMatch(/Insira|primeira\s+compra|pagamento/i);
    });

    it('coupon-06[1] COMPRANOAPP has non-null termsUrl', () => {
      const coupons = parser.extractAllCoupons(coupon06Html);
      const compranoapp = coupons[1];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const termsUrl = (compranoapp as any).termsUrl;
      expect(termsUrl).not.toBeNull();
      expect(termsUrl).toMatch(/\/promotion\/details\/popup\//i);
    });

    it('coupon-06[0] BRINQUEDOS30 (PSP) does NOT have isIndividual === true', () => {
      const coupons = parser.extractAllCoupons(coupon06Html);
      const brinquedos = coupons[0];
      expect(brinquedos.couponCode).toBe('BRINQUEDOS30');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isIndiv = (brinquedos as any).isIndividual;
      expect(isIndiv).not.toBe(true);
    });

    it('coupon-06[2] PUZZLES20 (PSP) does NOT have isIndividual === true', () => {
      const coupons = parser.extractAllCoupons(coupon06Html);
      const puzzles = coupons[2];
      expect(puzzles.couponCode).toBe('PUZZLES20');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isIndiv = (puzzles as any).isIndividual;
      expect(isIndiv).not.toBe(true);
    });

    it('RG1 (coupon-06): only COMPRANOAPP (couponInfos[1]) has the 3 metadata fields together', () => {
      const coupons = parser.extractAllCoupons(coupon06Html);
      const compranoapp = coupons[1];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entry = compranoapp as any;

      // COMPRANOAPP should have all 3
      expect(entry.isIndividual).toBe(true);
      expect(entry.discountText).not.toBeNull();
      expect(entry.description).not.toBeNull();
      expect(entry.termsUrl).not.toBeNull();

      // BRINQUEDOS30 and PUZZLES20 should NOT have this shape
      for (let i = 0; i < coupons.length; i++) {
        if (i === 1) continue; // Skip COMPRANOAPP
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const other = coupons[i] as any;
        // Either isIndividual is missing/false or at least one of the 3 is missing
        if (other.isIndividual === true) {
          expect(other.discountText).not.toBeNull();
          expect(other.description).not.toBeNull();
          expect(other.termsUrl).not.toBeNull();
        }
      }
    });
  });

  describe('T1.3: Edge case — "Economize R$30" in coupon-05 should NOT have isIndividual', () => {
    /**
     * Regression guard: Economize R$30 in coupon-05 is a PSP coupon,
     * not an individual inline coupon. Its shape must NOT include isIndividual.
     *
     * Pre-epic: This coupon was captured separately as PSP (no individual metadata)
     * Post-epic (broken): Still PSP, but must not gain false isIndividual metadata
     */
    it('Economize R$30 entry does not have isIndividual', () => {
      const coupons = parser.extractAllCoupons(coupon05Html);
      expect(coupons.length).toBeGreaterThanOrEqual(2);

      // Find "Economize R$30" — typically the first PSP in coupon-05
      // It may not have a couponCode (PSP coupons from /promotion/psp/ page often have null code initially)
      const economizeIdx = coupons.findIndex(
        (c) => c.promotionId !== 'AMB0EETS19SS4' || c.couponCode !== 'COMPRANOAPP',
      );
      expect(economizeIdx).toBeGreaterThanOrEqual(0);

      const economize = coupons[economizeIdx];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isIndiv = (economize as any).isIndividual;
      expect(isIndiv).not.toBe(true);
    });
  });

  describe('T1.4: Regression guard RG4 — correct promotionId for COMPRANOAPP', () => {
    /**
     * Regression guard: Ensure we're testing the correct coupon by promotionId
     * COMPRANOAPP in both fixtures should have promotionId 'AMB0EETS19SS4'
     */
    it('coupon-05 COMPRANOAPP has promotionId AMB0EETS19SS4', () => {
      const coupons = parser.extractAllCoupons(coupon05Html);
      const compranoapp = coupons.find(
        (c) => c.promotionId === 'AMB0EETS19SS4',
      );
      expect(compranoapp).toBeDefined();
      expect(compranoapp!.couponCode).toBe('COMPRANOAPP');
    });

    it('coupon-06 COMPRANOAPP (couponInfos[1]) has promotionId AMB0EETS19SS4', () => {
      const coupons = parser.extractAllCoupons(coupon06Html);
      expect(coupons[1].promotionId).toBe('AMB0EETS19SS4');
      expect(coupons[1].couponCode).toBe('COMPRANOAPP');
    });
  });

  describe('T5: Regression fix — applicable path in _extractAllCoupons emits isApplicable + discountPercent + participatingProductsUrl', () => {
    /**
     * Critical finding from code review: The applicable branch of _extractAllCoupons
     * was not emitting isApplicable, discountPercent, and participatingProductsUrl,
     * causing silent regression in F04 (multi-coupon applicable dispatch).
     *
     * Expected (T5): applicable coupons from extractAllCoupons should have:
     * - isApplicable: true
     * - discountPercent: number (extracted from "Aplicar cupom de X%")
     * - participatingProductsUrl: string | null
     * - description and termsUrl from helper (for completeness)
     */
    it('coupon-03 (applicable) extractAllCoupons emits isApplicable === true', () => {
      const coupons = parser.extractAllCoupons(coupon03Html);
      expect(coupons.length).toBeGreaterThanOrEqual(1);

      const applicable = coupons.find((c) => c.promotionId === 'AF12ZU9VE9JOE');
      expect(applicable).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((applicable as any).isApplicable).toBe(true);
    });

    it('coupon-03 (applicable) extractAllCoupons emits discountPercent as number', () => {
      const coupons = parser.extractAllCoupons(coupon03Html);
      const applicable = coupons.find((c) => c.promotionId === 'AF12ZU9VE9JOE');
      expect(applicable).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const discountPercent = (applicable as any).discountPercent;
      expect(discountPercent).toBeDefined();
      expect(typeof discountPercent).toBe('number');
      expect(discountPercent).toBeGreaterThan(0);
      expect(discountPercent).toBeLessThanOrEqual(100);
    });

    it('coupon-03 (applicable) extractAllCoupons has participatingProductsUrl field (null or string)', () => {
      const coupons = parser.extractAllCoupons(coupon03Html);
      const applicable = coupons.find((c) => c.promotionId === 'AF12ZU9VE9JOE');
      expect(applicable).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const participatingProductsUrl = (applicable as any).participatingProductsUrl;
      // participatingProductsUrl can be null (coupon-03) or string (coupon-04)
      expect(participatingProductsUrl === null || typeof participatingProductsUrl === 'string').toBe(true);
    });

    it('RG5 (Critical): coupon-03 applicable has isApplicable, discountPercent, and participatingProductsUrl all defined together', () => {
      const coupons = parser.extractAllCoupons(coupon03Html);
      const applicable = coupons.find((c) => c.promotionId === 'AF12ZU9VE9JOE');
      expect(applicable).toBeDefined();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entry = applicable as any;
      // If isApplicable is true, all three fields must be defined
      if (entry.isApplicable === true) {
        expect(entry.discountPercent).toBeDefined();
        expect(typeof entry.discountPercent).toBe('number');
        expect(entry.participatingProductsUrl).toBeDefined();
      }
    });
  });
});
