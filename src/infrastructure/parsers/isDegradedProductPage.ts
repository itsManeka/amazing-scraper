import * as cheerio from 'cheerio';

/**
 * Detects if an Amazon product page HTML is degraded (missing critical data).
 *
 * A page is considered degraded when BOTH conditions are true (AND logic):
 * 1. Product title (#productTitle) is missing or empty
 * 2. ALL price selectors are absent from the page
 *
 * Note: The <title> tag is NOT checked because anti-bot pages (CloudFront blocks)
 * can have a filled <title> with the actual product name but are still degraded
 * (missing #productTitle and all price elements). This heuristic avoids false
 * negatives by focusing on structural absence of critical product data.
 *
 * This still avoids false positives for legitimate out-of-stock pages,
 * which have productTitle + no prices (only one condition met).
 *
 * @param html - The raw HTML string of the product page
 * @returns true if the page shows signs of session degradation, false otherwise
 */
export function isDegradedProductPage(html: string): boolean {
  const $ = cheerio.load(html);

  // Condition 1: Check if #productTitle is absent or empty
  const productTitleText = $('#productTitle').text().trim();
  const productTitleEmpty = !productTitleText || productTitleText.length === 0;

  // Condition 2: Check if ALL price selectors are absent
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

  // Double AND: both conditions must be true
  return productTitleEmpty && allPriceSelectorsAbsent;
}
