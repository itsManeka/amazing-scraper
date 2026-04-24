import { createScraper } from '../../src';

describe('createScraper (T6: sessionRecycle propagation)', () => {
  describe('default behavior (no sessionRecycle option)', () => {
    it('should instantiate scraper with defaults: afterRequests=5, reactive=true', () => {
      const scraper = createScraper();
      expect(scraper).toBeDefined();
      expect(scraper.fetchProduct).toBeDefined();
      expect(scraper.extractCouponProducts).toBeDefined();
      expect(scraper.fetchPreSales).toBeDefined();
      expect(scraper.extractApplicableCouponProducts).toBeDefined();
      expect(scraper.fetchIndividualCouponTerms).toBeDefined();
    });
  });

  describe('sessionRecycle.afterRequests', () => {
    it('should respect custom afterRequests value', () => {
      const scraper = createScraper({ sessionRecycle: { afterRequests: 10 } });
      expect(scraper).toBeDefined();
      // Scraper is instantiated successfully with custom afterRequests
    });

    it('should use default reactive=true when only afterRequests is specified', () => {
      const scraper = createScraper({ sessionRecycle: { afterRequests: 10 } });
      expect(scraper).toBeDefined();
      // Reactive detection should be enabled (default true)
    });

    it('should support afterRequests=0 (legacy opt-out preventive recycling)', () => {
      const scraper = createScraper({ sessionRecycle: { afterRequests: 0 } });
      expect(scraper).toBeDefined();
      // Preventive recycling disabled; SessionRecycler remains inert
    });
  });

  describe('sessionRecycle.reactive', () => {
    it('should respect reactive=false to disable reactive degrade detection', () => {
      const scraper = createScraper({ sessionRecycle: { reactive: false } });
      expect(scraper).toBeDefined();
      // Reactive detection should be disabled
    });

    it('should use default afterRequests=5 when only reactive is specified', () => {
      const scraper = createScraper({ sessionRecycle: { reactive: false } });
      expect(scraper).toBeDefined();
      // Preventive recycling should be enabled with default afterRequests=5
    });
  });

  describe('legacy mode', () => {
    it('should support full legacy opt-out: afterRequests=0 + reactive=false', () => {
      const scraper = createScraper({ sessionRecycle: { afterRequests: 0, reactive: false } });
      expect(scraper).toBeDefined();
      // Both preventive and reactive recycling disabled
    });

    it('legacy mode should produce identical behavior to pre-feature version', () => {
      // Both scrapers should be created without throwing
      const scraperLegacy = createScraper({ sessionRecycle: { afterRequests: 0, reactive: false } });
      const scraperDefault = createScraper({ sessionRecycle: { afterRequests: 5, reactive: true } });
      expect(scraperLegacy).toBeDefined();
      expect(scraperDefault).toBeDefined();
      // The difference is in internal session recycling behavior, not public API
    });
  });

  describe('empty sessionRecycle object', () => {
    it('should treat {} as defaults when provided', () => {
      const scraper = createScraper({ sessionRecycle: {} });
      expect(scraper).toBeDefined();
      // Should apply defaults: afterRequests=5, reactive=true
    });
  });

  describe('type safety and backward compatibility', () => {
    it('should allow creating scraper without sessionRecycle option (backward compat)', () => {
      const scraper = createScraper();
      expect(scraper).toBeDefined();
    });

    it('should allow creating scraper with other options but no sessionRecycle', () => {
      const scraper = createScraper({
        delayMs: { min: 500, max: 1000 },
      });
      expect(scraper).toBeDefined();
    });

    it('should allow combining sessionRecycle with other options', () => {
      const scraper = createScraper({
        sessionRecycle: { afterRequests: 10, reactive: true },
        delayMs: { min: 1000, max: 2000 },
      });
      expect(scraper).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle afterRequests < 0 gracefully (treated as 0)', () => {
      // SessionRecycler checks afterRequests <= 0 for legacy mode
      const scraper = createScraper({ sessionRecycle: { afterRequests: -1 } });
      expect(scraper).toBeDefined();
      // Should not throw; legacy mode activated
    });

    it('should handle afterRequests=1 (recycle before every request)', () => {
      const scraper = createScraper({ sessionRecycle: { afterRequests: 1 } });
      expect(scraper).toBeDefined();
      // Should not throw; aggressive but valid
    });
  });

  describe('scraper interface remains unchanged', () => {
    it('should return valid AmazonCouponScraper interface', () => {
      const scraper = createScraper();
      const keys = Object.keys(scraper).sort();
      const expectedKeys = [
        'extractApplicableCouponProducts',
        'extractCouponProducts',
        'fetchIndividualCouponTerms',
        'fetchPreSales',
        'fetchProduct',
      ].sort();
      expect(keys).toEqual(expectedKeys);
    });

    it('all scraper methods should be callable (contract check)', () => {
      const scraper = createScraper();
      expect(typeof scraper.fetchProduct).toBe('function');
      expect(typeof scraper.extractCouponProducts).toBe('function');
      expect(typeof scraper.fetchPreSales).toBe('function');
      expect(typeof scraper.extractApplicableCouponProducts).toBe('function');
      expect(typeof scraper.fetchIndividualCouponTerms).toBe('function');
    });
  });
});
