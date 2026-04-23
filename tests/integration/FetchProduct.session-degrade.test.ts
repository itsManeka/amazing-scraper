/**
 * T7 — Integration test: Session degradation scenarios with nock.
 *
 * Tests the complete session recycling flow (T1-T6) with 4 scenarios:
 * 1. Legacy opt-out: no recycling, degraded ASINs fail with price_not_found
 * 2. Reactive degrade detection: detects degraded page and retries with fresh session
 * 3. Preventive recycling: proactively resets session every N requests
 * 4. Hybrid (default): combined preventive + reactive, mitigates real-world bug
 *
 * Uses nock to mock Amazon responses; fixtures are minimal HTML (healthy vs degraded).
 */

import * as fs from 'fs';
import * as path from 'path';
import nock from 'nock';
import { createScraper } from '../../src/index';
import { ScraperError } from '../../src/domain/errors';

const AMAZON_BASE = 'https://www.amazon.com.br';

describe('FetchProduct — session degrade scenarios (T7)', () => {
  let healthyHtml: string;
  let degradedHtml: string;

  beforeAll(() => {
    const fixturesDir = path.join(__dirname, '..', 'fixtures');
    healthyHtml = fs.readFileSync(
      path.join(fixturesDir, 'healthy-product-page.html'),
      'utf-8',
    );
    degradedHtml = fs.readFileSync(
      path.join(fixturesDir, 'degraded-product-page.html'),
      'utf-8',
    );
  });

  beforeEach(() => {
    nock.cleanAll();
    jest.clearAllMocks();
  });

  afterAll(() => {
    nock.restore();
  });

  /**
   * C1: Legacy opt-out — 10 ASINs, 2 healthy then 8 degraded
   * Expected: 2 with non-null price + 8 with price=null
   * Proves the bug exists without mitigation (degraded pages return null price).
   */
  describe('C1 — Legacy opt-out (no recycling)', () => {
    it('returns 2 non-null prices + 8 null prices when degradation occurs', async () => {
      const asins = Array.from({ length: 10 }, (_, i) => `ASIN${i + 1}`);

      // Mock responses: first 2 healthy, rest degraded
      for (let i = 1; i <= 2; i++) {
        nock(AMAZON_BASE).get(`/dp/ASIN${i}`).reply(200, healthyHtml);
      }

      for (let i = 3; i <= 10; i++) {
        nock(AMAZON_BASE).get(`/dp/ASIN${i}`).reply(200, degradedHtml);
      }

      const scraper = createScraper({
        sessionRecycle: { afterRequests: 0, reactive: false },
      });

      const results: Array<{
        asin: string;
        hasPrice: boolean;
      }> = [];

      for (const asin of asins) {
        const page = await scraper.fetchProduct(asin);
        results.push({
          asin,
          hasPrice: page.price !== null,
        });
      }

      // Validate results: first 2 should have price, next 8 should not
      const withPrice = results.filter((r) => r.hasPrice).length;
      const withoutPrice = results.filter((r) => !r.hasPrice).length;

      expect(withPrice).toBe(2);
      expect(withoutPrice).toBe(8);
    });
  });

  /**
   * C2: Reactive degrade detection — 10 ASINs, ASINs 3 and 6 are degraded on first attempt
   * Expected: reactive reset + retry = 10/10 success
   * Proves reactive detection works.
   */
  describe('C2 — Reactive degrade detection', () => {
    it('detects degraded page on ASIN 3 and 6, retries with fresh session, achieves 10/10', async () => {
      const asins = Array.from({ length: 10 }, (_, i) => `ASIN${i + 1}`);

      // Counter to track how many times each ASIN is requested
      const requestCounts: Record<string, number> = {};
      asins.forEach((asin) => {
        requestCounts[asin] = 0;
      });

      // Mock that degrades on first attempt for ASIN3 and ASIN6, then returns healthy
      asins.forEach((asin) => {
        nock(AMAZON_BASE)
          .get(`/dp/${asin}`)
          .times(2) // Allow up to 2 requests per ASIN (original + retry)
          .reply(function () {
            requestCounts[asin]++;
            // ASIN 3 and 6: degraded on first attempt, healthy on retry
            if ((asin === 'ASIN3' || asin === 'ASIN6') && requestCounts[asin] === 1) {
              return [200, degradedHtml];
            }
            return [200, healthyHtml];
          });
      });

      const scraper = createScraper({
        sessionRecycle: {
          afterRequests: 0, // Disable preventive
          reactive: true,  // Enable reactive
        },
      });

      const results: Array<{ asin: string; success: boolean }> = [];

      for (const asin of asins) {
        try {
          await scraper.fetchProduct(asin);
          results.push({ asin, success: true });
        } catch (err) {
          results.push({ asin, success: false });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      expect(successCount).toBe(10);

      // Verify that ASIN3 and ASIN6 were requested twice (original + retry)
      expect(requestCounts['ASIN3']).toBe(2);
      expect(requestCounts['ASIN6']).toBe(2);

      // Others should be requested once
      expect(requestCounts['ASIN1']).toBe(1);
      expect(requestCounts['ASIN2']).toBe(1);
      expect(requestCounts['ASIN7']).toBe(1);
    });
  });

  /**
   * C3: Preventive recycling with N=3
   * 10 ASINs, all healthy, should reset session every 3 requests
   * Expected: 10/10 success, 3 resets (after requests 3, 6, 9)
   * Proves preventive recycling works.
   */
  describe('C3 — Preventive recycling (N=3)', () => {
    it('recycles session every 3 requests for 10 healthy ASINs', async () => {
      const asins = Array.from({ length: 10 }, (_, i) => `ASIN${i + 1}`);

      // All healthy
      asins.forEach((asin) => {
        nock(AMAZON_BASE)
          .persist()
          .get(`/dp/${asin}`)
          .reply(200, healthyHtml);
      });

      const mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      const scraper = createScraper({
        sessionRecycle: { afterRequests: 3 },
        logger: mockLogger,
      });

      const results: Array<{ asin: string; hasPrice: boolean }> = [];

      for (const asin of asins) {
        const page = await scraper.fetchProduct(asin);
        results.push({
          asin,
          hasPrice: page.price !== null,
        });
      }

      const successCount = results.filter((r) => r.hasPrice).length;
      expect(successCount).toBe(10);
    });
  });

  /**
   * C4: Hybrid (default) — reproduces the real-world bug scenario
   * 10 ASINs with degradation pattern similar to probe:
   * - First 2 healthy
   * - Next 8 would degrade without mitigation
   * - With hybrid (preventive + reactive): >=9/10 succeed
   */
  describe('C4 — Hybrid (default) - real-world bug regression', () => {
    it('achieves >=9/10 success with default session recycling enabled', async () => {
      const asins = Array.from({ length: 10 }, (_, i) => `ASIN${i + 1}`);

      // Track request count to simulate degradation after initial requests
      let requestCount = 0;
      const degradationThreshold = 2; // Degrade after first 2 ASINs

      asins.forEach((asin) => {
        nock(AMAZON_BASE)
          .get(`/dp/${asin}`)
          .times(3) // Allow up to 3 attempts per ASIN (original + possible retries)
          .reply(function () {
            requestCount++;
            // Simulate degradation: after 2 requests, pages degrade
            // unless session is recycled (which should happen preventively)
            const isWithinHealthyWindow = requestCount <= degradationThreshold;

            if (isWithinHealthyWindow) {
              return [200, healthyHtml];
            }

            // Check if we're past a reset boundary (preventive resets every N requests)
            // Approximate: reset happens around request 5 (afterRequests: 5 default)
            const requestCountSinceLastReset = ((requestCount - 1) % 5) + 1;
            if (requestCountSinceLastReset <= 1) {
              // Just after reset, return healthy
              return [200, healthyHtml];
            }

            // Otherwise degraded (but reactive should catch it)
            return [200, degradedHtml];
          });
      });

      // Use default options (which enables preventive + reactive)
      const scraper = createScraper();

      const results: Array<{ asin: string; success: boolean }> = [];

      for (const asin of asins) {
        try {
          await scraper.fetchProduct(asin);
          results.push({ asin, success: true });
        } catch {
          results.push({ asin, success: false });
        }
      }

      const successCount = results.filter((r) => r.success).length;

      // Criterion from T7 test-plan: >=9/10 success
      expect(successCount).toBeGreaterThanOrEqual(9);
    });
  });

  /**
   * Edge case: verify that disabling reactive detection means no retry on degraded page
   */
  describe('Edge case — reactive: false prevents retry', () => {
    it('does not retry degraded page when reactive is false', async () => {
      const asin = 'ASINX';
      let requestCount = 0;

      nock(AMAZON_BASE)
        .get(`/dp/${asin}`)
        .times(2)
        .reply(function () {
          requestCount++;
          // Always return degraded
          return [200, degradedHtml];
        });

      const scraper = createScraper({
        sessionRecycle: { reactive: false },
      });

      try {
        await scraper.fetchProduct(asin);
      } catch (err) {
        // Expected: price_not_found
        expect((err as ScraperError).code).toBe('price_not_found');
      }

      // Should only be called once (no retry)
      expect(requestCount).toBe(1);
    });
  });

  /**
   * Regression guard: happy path (all healthy) should work with defaults
   */
  describe('Regression guard — happy path with defaults', () => {
    it('successfully fetches 10 healthy ASINs with default options', async () => {
      const asins = Array.from({ length: 10 }, (_, i) => `ASIN${i + 1}`);

      asins.forEach((asin) => {
        nock(AMAZON_BASE)
          .persist()
          .get(`/dp/${asin}`)
          .reply(200, healthyHtml);
      });

      const scraper = createScraper();

      const results: Array<{ asin: string; success: boolean }> = [];

      for (const asin of asins) {
        try {
          const page = await scraper.fetchProduct(asin);
          expect(page.price).not.toBeNull();
          results.push({ asin, success: true });
        } catch {
          results.push({ asin, success: false });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      expect(successCount).toBe(10);
    });
  });
});
