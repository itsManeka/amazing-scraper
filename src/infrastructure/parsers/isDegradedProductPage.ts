import * as cheerio from 'cheerio';

/**
 * Detects if an Amazon product page HTML is degraded (missing critical data).
 *
 * A page is considered degraded when ALL THREE conditions are true (AND logic):
 * 1. Title is missing, empty, or contains only generic "Amazon.com.br" text
 * 2. Product title (#productTitle) is missing or empty
 * 3. ALL price selectors are absent from the page
 *
 * This heuristic avoids false positives for legitimate out-of-stock pages,
 * which may have title + productTitle + no prices, but should return false
 * (only out-of-stock status, not a session degradation).
 *
 * @param html - The raw HTML string of the product page
 * @returns true if the page shows signs of session degradation, false otherwise
 */
export function isDegradedProductPage(html: string): boolean {
  const $ = cheerio.load(html);

  // Condition 1: Check if <title> is absent, empty, or generic
  const titleText = $('title').text().trim();
  const titleDegraded =
    !titleText ||
    titleText.length === 0 ||
    titleText === 'Amazon.com.br' ||
    /^Amazon\.com\.br\s*$/i.test(titleText);

  // Condition 2: Check if #productTitle is absent or empty
  const productTitleText = $('#productTitle').text().trim();
  const productTitleDegraded = !productTitleText || productTitleText.length === 0;

  // Condition 3: Check if ALL price selectors are absent
  // Price sources include traditional price blocks AND PromotionsDiscovery container
  const priceSelectors = [
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '#priceblock_saleprice',
    '.a-price .a-offscreen',
    'span.a-price[data-a-size=xl] .a-offscreen',
    '#corePrice_feature_div .a-offscreen',
    '[data-csa-c-owner="PromotionsDiscovery"]', // Coupon via PromotionsDiscovery container
  ];

  let allPriceSelectorsAbsent = true;
  for (const selector of priceSelectors) {
    if ($(selector).length > 0) {
      allPriceSelectorsAbsent = false;
      break;
    }
  }

  // Triple AND: all three conditions must be true
  return titleDegraded && productTitleDegraded && allPriceSelectorsAbsent;
}
