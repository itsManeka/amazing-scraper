/**
 * T1 — Integration test: FetchProduct use-case end-to-end with real fixture HTML (coupon-03).
 *
 * Validates that createScraper().fetchProduct() — using the real CheerioHtmlParser —
 * correctly extracts IndividualCouponInfo from the real Amazon page HTML for B0GFMC7BHK
 * (AUXOM Potes Hermeticos), which carries an applicable coupon ("Aplicar cupom de 10%").
 *
 * This is the RED phase of the feature f10-applicable-detection-real-page:
 * the fixture diverges from the synthetic coupon-03.html used in F02 unit tests,
 * so this integration test serves as the reproducer to guide the fix (caminho A or B).
 *
 * The test serves the fixture via nock so no network access is required.
 */
import * as fs from 'fs';
import * as path from 'path';
import nock from 'nock';
import { createScraper } from '../../src/index';

const AMAZON_BASE = 'https://www.amazon.com.br';
const ASIN = 'B0GFMC7BHK'; // AUXOM Potes Hermeticos de Vidro com Tampa de Bambu

describe('FetchProduct — applicable coupon-03-real integration (T1)', () => {
  let productHtml: string;

  beforeAll(() => {
    const fixturesDir = path.join(__dirname, '..', 'fixtures');
    productHtml = fs.readFileSync(
      path.join(fixturesDir, 'coupons', 'applicable', 'product-coupon-03-real.html'),
      'utf-8',
    );
  });

  beforeEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.restore();
  });

  it('returns individualCouponInfo with isApplicable === true', async () => {
    nock(AMAZON_BASE)
      .get(`/dp/${ASIN}`)
      .reply(200, productHtml);

    const scraper = createScraper();
    const page = await scraper.fetchProduct(ASIN);

    expect(page.individualCouponInfo).not.toBeNull();
    expect(page.individualCouponInfo!.isApplicable).toBe(true);
  });

  it('returns individualCouponInfo.discountPercent === 10', async () => {
    nock(AMAZON_BASE)
      .get(`/dp/${ASIN}`)
      .reply(200, productHtml);

    const scraper = createScraper();
    const page = await scraper.fetchProduct(ASIN);

    expect(page.individualCouponInfo).not.toBeNull();
    expect(page.individualCouponInfo!.discountPercent).toBe(10);
  });

  it('returns individualCouponInfo.participatingProductsUrl === null', async () => {
    nock(AMAZON_BASE)
      .get(`/dp/${ASIN}`)
      .reply(200, productHtml);

    const scraper = createScraper();
    const page = await scraper.fetchProduct(ASIN);

    expect(page.individualCouponInfo).not.toBeNull();
    expect(page.individualCouponInfo!.participatingProductsUrl).toBeNull();
  });

  it('returns individualCouponInfo.couponCode === null (applicable, not code-based)', async () => {
    nock(AMAZON_BASE)
      .get(`/dp/${ASIN}`)
      .reply(200, productHtml);

    const scraper = createScraper();
    const page = await scraper.fetchProduct(ASIN);

    expect(page.individualCouponInfo).not.toBeNull();
    expect(page.individualCouponInfo!.couponCode).toBeNull();
  });

  it('returns isIndividual: true discriminant on the info object', async () => {
    nock(AMAZON_BASE)
      .get(`/dp/${ASIN}`)
      .reply(200, productHtml);

    const scraper = createScraper();
    const page = await scraper.fetchProduct(ASIN);

    expect(page.individualCouponInfo).not.toBeNull();
    expect(page.individualCouponInfo!.isIndividual).toBe(true);
  });
});
