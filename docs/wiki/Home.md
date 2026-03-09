# amazing-scraper

TypeScript library for scraping Amazon Brasil product data — coupon promotions, product pages, and HQ/Manga pre-sale listings.

## Pages

- [Architecture](Architecture) — Clean Architecture layers and module overview
- [API Reference](API-Reference) — Generated API documentation (TypeDoc)
- [Changelog](Changelog) — Release history
- [Contributing](Contributing) — How to contribute, commit conventions, development setup

## Quick Links

- [npm package](https://www.npmjs.com/package/amazing-scraper)
- [GitHub repository](https://github.com/itsmaneka/amazing-scraper)
- [Issues](https://github.com/itsmaneka/amazing-scraper/issues)

## Installation

```bash
npm install amazing-scraper
```

## Usage

```typescript
import { createScraper } from 'amazing-scraper';

const scraper = createScraper();

const page = await scraper.fetchProduct('B0EXAMPLE1');
console.log(page.title, page.price, page.inStock);

if (page.hasCoupon && page.couponInfo) {
  const result = await scraper.extractCouponProducts(page.couponInfo);
  console.log(`Found ${result.totalProducts} products`);
}

const preSales = await scraper.fetchPreSales({ limit: 3 });
console.log(`Found ${preSales.asins.length} pre-sale ASINs`);
```
