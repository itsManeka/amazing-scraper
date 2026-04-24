import { isDegradedProductPage } from '../../src/infrastructure/parsers/isDegradedProductPage';

describe('isDegradedProductPage', () => {
  describe('Happy path — degraded pages', () => {
    it('returns true when both conditions are met (no productTitle, no prices)', () => {
      const degradedHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title></title>
          </head>
          <body>
            <div id="pageContent"></div>
          </body>
        </html>
      `;
      expect(isDegradedProductPage(degradedHtml)).toBe(true);
    });

    it('returns true when title is filled but productTitle is empty and no prices (real anti-bot scenario)', () => {
      const degradedHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>The Boys Oversized Hardcover Omnibus Volume 3 | Amazon.com.br</title>
          </head>
          <body>
            <div id="pageContent"></div>
          </body>
        </html>
      `;
      expect(isDegradedProductPage(degradedHtml)).toBe(true);
    });

    it('returns true when title is generic "Amazon.com.br" with no productTitle or prices', () => {
      const degradedHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Amazon.com.br</title>
          </head>
          <body>
            <div id="pageContent"></div>
          </body>
        </html>
      `;
      expect(isDegradedProductPage(degradedHtml)).toBe(true);
    });
  });

  describe('Happy path — healthy pages', () => {
    it('returns false when title is present, productTitle is present, and price is present', () => {
      const healthyHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Product Name | Amazon.com.br</title>
          </head>
          <body>
            <h1 id="productTitle">Amazing Product</h1>
            <div id="priceblock_ourprice">R$ 99,90</div>
          </body>
        </html>
      `;
      expect(isDegradedProductPage(healthyHtml)).toBe(false);
    });

    it('returns false when using alternative price selector (a-offscreen)', () => {
      const healthyHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Product Name | Amazon.com.br</title>
          </head>
          <body>
            <h1 id="productTitle">Amazing Product</h1>
            <span class="a-price">
              <span class="a-offscreen">R$ 49,99</span>
            </span>
          </body>
        </html>
      `;
      expect(isDegradedProductPage(healthyHtml)).toBe(false);
    });

    it('returns false when using #corePrice_feature_div .a-offscreen selector', () => {
      const healthyHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Book Title | Amazon.com.br</title>
          </head>
          <body>
            <h1 id="productTitle">Book Amazing Title</h1>
            <div id="corePrice_feature_div">
              <span class="a-offscreen">R$ 159,90</span>
            </div>
          </body>
        </html>
      `;
      expect(isDegradedProductPage(healthyHtml)).toBe(false);
    });

    it('returns false when using span.a-price[data-a-size=xl] .a-offscreen selector', () => {
      const healthyHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Product Name | Amazon.com.br</title>
          </head>
          <body>
            <h1 id="productTitle">Product Name</h1>
            <span class="a-price" data-a-size="xl">
              <span class="a-offscreen">R$ 199,00</span>
            </span>
          </body>
        </html>
      `;
      expect(isDegradedProductPage(healthyHtml)).toBe(false);
    });
  });

  describe('Critical RG — out-of-stock is NOT degraded', () => {
    it('returns false for legitimate out-of-stock (title + productTitle + no prices)', () => {
      const outOfStockHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Manga Vol. 42 - Out of Stock | Amazon.com.br</title>
          </head>
          <body>
            <h1 id="productTitle">Manga Volume 42 Special Edition</h1>
            <div id="stockMessage">Atualmente indisponível</div>
          </body>
        </html>
      `;
      expect(isDegradedProductPage(outOfStockHtml)).toBe(false);
    });

    it('returns false for pre-order without current price (title + productTitle + no prices)', () => {
      const preOrderHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Upcoming Release - Manga Vol. 50 | Amazon.com.br</title>
          </head>
          <body>
            <h1 id="productTitle">Manga Volume 50 - Coming Soon</h1>
            <div id="preOrderMessage">Pre-order available soon</div>
          </body>
        </html>
      `;
      expect(isDegradedProductPage(preOrderHtml)).toBe(false);
    });
  });

  describe('Edge cases — single missing condition is NOT degraded', () => {
    it('returns false when productTitle is present (has at least one of two conditions)', () => {
      const edgeHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title></title>
          </head>
          <body>
            <h1 id="productTitle">Product with Title</h1>
            <div id="otherContent">No prices</div>
          </body>
        </html>
      `;
      expect(isDegradedProductPage(edgeHtml)).toBe(false);
    });

    it('returns false when only productTitle is missing but price is present (price present = not degraded)', () => {
      const edgeHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Book Name | Amazon.com.br</title>
          </head>
          <body>
            <h1 id="productTitle"></h1>
            <div id="priceblock_dealprice">R$ 79,90</div>
          </body>
        </html>
      `;
      expect(isDegradedProductPage(edgeHtml)).toBe(false);
    });

    it('returns false when only price is missing but productTitle is present (productTitle present = not degraded)', () => {
      const edgeHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Product Name | Amazon.com.br</title>
          </head>
          <body>
            <h1 id="productTitle">Product with Title</h1>
            <div id="otherContent">Some content</div>
          </body>
        </html>
      `;
      expect(isDegradedProductPage(edgeHtml)).toBe(false);
    });
  });

  describe('Edge cases — whitespace and normalization', () => {
    it('treats empty title the same as missing title (both degrade if productTitle + prices also missing)', () => {
      const emptyTitleHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>   </title>
          </head>
          <body>
            <div id="pageContent"></div>
          </body>
        </html>
      `;
      expect(isDegradedProductPage(emptyTitleHtml)).toBe(true);
    });

    it('trims whitespace from productTitle correctly (whitespace-only = empty = counts as missing)', () => {
      const whitespaceHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Book Title | Amazon.com.br</title>
          </head>
          <body>
            <h1 id="productTitle">  </h1>
            <div id="priceblock_ourprice">R$ 99,90</div>
          </body>
        </html>
      `;
      expect(isDegradedProductPage(whitespaceHtml)).toBe(false);
    });

    it('ignores title format entirely (filled or generic) if productTitle is present and prices exist', () => {
      const mixedHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>amazon.com.br</title>
          </head>
          <body>
            <h1 id="productTitle">Real Product Name</h1>
            <div id="priceblock_ourprice">R$ 50,00</div>
          </body>
        </html>
      `;
      expect(isDegradedProductPage(mixedHtml)).toBe(false);
    });
  });

  describe('Real-world scenario — degraded session after CAPTCHA', () => {
    it('detects CloudFront block response (minimal title, no productTitle, no prices)', () => {
      const cloudFrontBlockHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Amazon.com.br</title>
          </head>
          <body>
            <div class="cf-error-details">
              Request blocked by security rules
            </div>
          </body>
        </html>
      `;
      expect(isDegradedProductPage(cloudFrontBlockHtml)).toBe(true);
    });

    it('detects session timeout page (missing critical sections)', () => {
      const sessionTimeoutHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title></title>
          </head>
          <body>
            <p>Your session has expired. Please try again.</p>
          </body>
        </html>
      `;
      expect(isDegradedProductPage(sessionTimeoutHtml)).toBe(true);
    });
  });

  describe('FINDING 1 — PromotionsDiscovery coupon support', () => {
    it('returns false when product has PromotionsDiscovery coupon (no traditional priceblock)', () => {
      const promotionsDiscoveryHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Product with Coupon | Amazon.com.br</title>
          </head>
          <body>
            <h1 id="productTitle">Product with Coupon Offer</h1>
            <div data-csa-c-owner="PromotionsDiscovery">
              <span>R$ 99,90 com cupom</span>
            </div>
          </body>
        </html>
      `;
      expect(isDegradedProductPage(promotionsDiscoveryHtml)).toBe(false);
    });

    it('returns true when PromotionsDiscovery is absent along with all other prices (all 3 conditions met)', () => {
      const noPricesHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title></title>
          </head>
          <body>
            <div id="pageContent"></div>
          </body>
        </html>
      `;
      // Missing: title (empty), productTitle (empty), and all prices
      expect(isDegradedProductPage(noPricesHtml)).toBe(true);
    });
  });
});
