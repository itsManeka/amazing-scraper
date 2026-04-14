/**
 * T9 — Integration test: FetchProduct use-case end-to-end with real fixture HTML.
 *
 * Validates that createScraper().fetchProduct() — using the real CheerioHtmlParser —
 * correctly extracts IndividualCouponInfo from the "A geracao incrivel" product page
 * (ASIN 6554851836) that ships a R$20 off inline coupon (code VEMNOAPP).
 *
 * The test serves the fixture via nock so no network access is required.
 */
import * as fs from 'fs';
import * as path from 'path';
import nock from 'nock';
import { createScraper } from '../../src/index';

const AMAZON_BASE = 'https://www.amazon.com.br';
const ASIN = '6554851836';

describe('FetchProduct — individual coupon integration (T9)', () => {
  let productHtml: string;

  beforeAll(() => {
    const fixturesDir = path.join(__dirname, '..', 'fixtures');
    productHtml = fs.readFileSync(
      path.join(fixturesDir, 'product-with-individual-coupon.html'),
      'utf-8',
    );
  });

  beforeEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.restore();
  });

  it('returns individualCouponInfo.promotionId === "ATVO4IBO0PTIE"', async () => {
    nock(AMAZON_BASE)
      .get(`/dp/${ASIN}`)
      .reply(200, productHtml);

    const scraper = createScraper();
    const page = await scraper.fetchProduct(ASIN);

    expect(page.individualCouponInfo).not.toBeNull();
    expect(page.individualCouponInfo!.promotionId).toBe('ATVO4IBO0PTIE');
  });

  it('returns individualCouponInfo.couponCode === "VEMNOAPP"', async () => {
    nock(AMAZON_BASE)
      .get(`/dp/${ASIN}`)
      .reply(200, productHtml);

    const scraper = createScraper();
    const page = await scraper.fetchProduct(ASIN);

    expect(page.individualCouponInfo).not.toBeNull();
    expect(page.individualCouponInfo!.couponCode).toBe('VEMNOAPP');
  });

  it('returns termsUrl containing /promotion/details/popup/ATVO4IBO0PTIE', async () => {
    nock(AMAZON_BASE)
      .get(`/dp/${ASIN}`)
      .reply(200, productHtml);

    const scraper = createScraper();
    const page = await scraper.fetchProduct(ASIN);

    expect(page.individualCouponInfo).not.toBeNull();
    expect(page.individualCouponInfo!.termsUrl).toContain(
      '/promotion/details/popup/ATVO4IBO0PTIE',
    );
  });

  it('leaves couponInfo null (no PSP coupon in the individual-coupon fixture)', async () => {
    nock(AMAZON_BASE)
      .get(`/dp/${ASIN}`)
      .reply(200, productHtml);

    const scraper = createScraper();
    const page = await scraper.fetchProduct(ASIN);

    expect(page.couponInfo).toBeNull();
  });

  it('returns isIndividual: true discriminant on the info object', async () => {
    nock(AMAZON_BASE)
      .get(`/dp/${ASIN}`)
      .reply(200, productHtml);

    const scraper = createScraper();
    const page = await scraper.fetchProduct(ASIN);

    expect(page.individualCouponInfo!.isIndividual).toBe(true);
  });
});
