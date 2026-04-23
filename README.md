# amazing-scraper

[![npm version](https://badge.fury.io/js/amazing-scraper.svg)](https://badge.fury.io/js/amazing-scraper)
[![CI](https://github.com/itsManeka/amazing-scraper/workflows/CI/badge.svg)](https://github.com/itsManeka/amazing-scraper/actions)
[![codecov](https://codecov.io/github/itsManeka/amazing-scraper/graph/badge.svg?token=02QHN94WKP)](https://codecov.io/github/itsManeka/amazing-scraper)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-yellow.svg)](https://conventionalcommits.org)
[![semantic-release](https://img.shields.io/badge/semantic--release-e10079?logo=semantic-release)](https://github.com/semantic-release/semantic-release)

TypeScript library for scraping Amazon Brasil product data — coupon promotions, product pages, and HQ/Manga pre-sale listings.

Given a product ASIN, it discovers the active coupon, extracts the CSRF token, paginates through all participating products, and returns a structured result. It can also fetch pre-sale ASINs from the Amazon Brasil HQ & Manga category.

## Installation

```bash
npm install amazing-scraper
```

## Quick Start

```typescript
import { createScraper } from 'amazing-scraper';

const scraper = createScraper();

// Step 1: Fetch the product page
const page = await scraper.fetchProduct('B0EXAMPLE1');
console.log(page.title, page.price, page.inStock, page.format);

// Step 2: Extract coupon products (only if coupon exists)
if (page.hasCoupon && page.couponInfo) {
  const result = await scraper.extractCouponProducts(page.couponInfo);
  console.log(`${result.metadata?.title} — expires: ${result.metadata?.expiresAt}`);
  console.log(`Found ${result.totalProducts} products`);
  for (const product of result.products) {
    console.log(`${product.title} — ${product.price}`);
  }
} else {
  console.log(`No coupon found for ASIN ${page.asin}`);
}

// Products may have multiple coupons — iterate couponInfos and dispatch by type flag
for (const couponInfo of page.couponInfos) {
  if (couponInfo.isApplicable) {
    // Automatic checkout coupon (no code); use extractApplicableCouponProducts
    const result = await scraper.extractApplicableCouponProducts(couponInfo as IndividualCouponInfo, page.asin);
    console.log(`Applicable: ${couponInfo.discountPercent}% off — ${result.asins.length} ASINs`);
  } else if (couponInfo.isIndividual) {
    // Inline coupon with code; title/description/termsUrl available directly
    console.log(`Individual: ${couponInfo.discountText} off with code ${couponInfo.couponCode}`);
    console.log(`Terms: ${couponInfo.description}`);
  } else {
    // PSP coupon; use extractCouponProducts for full product list
    const result = await scraper.extractCouponProducts(couponInfo);
    console.log(`PSP: ${result.metadata?.title} — ${result.totalProducts} products`);
  }
}

// Or: Fetch pre-sale ASINs from HQ & Manga category
const preSales = await scraper.fetchPreSales({ limit: 3 });
console.log(`Found ${preSales.asins.length} pre-sale ASINs`);
```

## API Reference

### `createScraper(options?)`

Creates a scraper instance.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `delayMs` | `{ min: number; max: number }` | `{ min: 1000, max: 2000 }` | Random delay range (ms) between HTTP requests |
| `logger` | `Logger` | `ConsoleLogger` | Custom logger implementation |
| `paginationLimits` | `PaginationLimits` | `{ maxProducts: 1000, maxPages: 500 }` | Safety limits to prevent runaway extraction |
| `userAgentProvider` | `UserAgentProvider` | `RotatingUserAgentProvider` | Custom User-Agent provider |
| `retryPolicy` | `RetryPolicy` | `ExponentialBackoffRetry` | Custom retry policy for transient errors |
| `onBlocked` | `(error: ScraperError) => Promise<void>` | — | Callback invoked before throwing on block/CAPTCHA errors |
| `httpClient` | `HttpClient` | `AxiosHttpClient` | Custom HTTP client with cookie jar |
| `sessionRecycle` | `{ afterRequests?: number; reactive?: boolean }` | `{ afterRequests: 5, reactive: true }` | Session degradation mitigation. `afterRequests`: recycle the cookie jar every N successful requests (0 = disabled). `reactive`: when a degraded page is detected (blank title + no price selectors), reset the session and retry once before raising `price_not_found`. Set `{ afterRequests: 0, reactive: false }` to restore pre-mitigation behaviour. |

Returns an `AmazonCouponScraper` with the following methods:

### `scraper.fetchProduct(asin: string)`

Fetches a single product page and returns its structured data. Does not follow coupon links or paginate.

Returns `ProductPage`:

```typescript
interface ProductPage {
  asin: string;
  title: string;
  price: string;           // e.g. "R$ 99,90"
  originalPrice: string;   // e.g. "R$ 149,90"
  prime: boolean;
  rating: number;
  reviewCount: number;
  hasCoupon: boolean;
  couponInfo: CouponInfo | null;  // First PSP coupon found; null when only individual coupons are present
  couponInfos: CouponInfo[];      // All coupons on the page; each entry carries discriminating flags (isIndividual, isApplicable) — use these to dispatch without a second DOM pass
  url: string;
  offerId?: string;        // Offer listing ID from the buy-box
  inStock: boolean;
  imageUrl?: string;       // High-resolution product image
  isPreOrder: boolean;
  format?: string;         // e.g. "Capa dura", "Capa Comum", "Kindle"
  publisher?: string;      // e.g. "Intrínseca", "Panini"
  contributors?: string[]; // e.g. ["Author (Autor)", "Translator (Tradutor)"]
  productGroup?: string;   // e.g. "book_display_on_website"
}
```

### `CouponInfo`

Base type for all coupons returned in `couponInfos`. PSP coupons carry only `promotionId` and `couponCode`; individual and applicable coupons carry additional fields set by the parser.

```typescript
interface CouponInfo {
  promotionId: string;
  couponCode: string | null;
  // Discriminating flags (set for inline coupons; absent or false for PSP coupons)
  isIndividual?: true;                        // Classic inline coupon with a code ("Insira o código")
  isApplicable?: boolean;                     // Automatic checkout coupon (no code required)
  // Inline metadata (present when isIndividual or isApplicable is set)
  discountText?: string | null;               // Badge value: "R$20", "20%", etc.
  description?: string | null;               // Cleaned terms text from the inline block
  termsUrl?: string | null;                  // URL to fetch coupon terms/conditions
  discountPercent?: number | null;           // Numeric value for applicable coupons (e.g. 10 for "10% off")
  participatingProductsUrl?: string | null;  // Coupon page URL when applicable has a product list
}
```

### `scraper.extractCouponProducts(couponInfo: CouponInfo)`

Extracts all products participating in a coupon promotion. Requires `CouponInfo` previously obtained from `fetchProduct`.

Returns `CouponResult`:

```typescript
{
  promotionId: string;
  totalProducts: number;
  products: Product[];
  metadata?: CouponMetadata;
}
```

### `scraper.fetchPreSales(options?)`

Fetches pre-sale ASINs from the Amazon Brasil HQ & Manga search page. Paginates through results and stops based on page limit or a stop-ASIN sentinel.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `limit` | `number` | `5` | Maximum number of search pages to fetch |
| `stopAtAsin` | `string` | — | Stop before this ASIN (excluded from result). Useful for incremental daily fetches |

Returns `FetchPreSalesResult`:

```typescript
interface FetchPreSalesResult {
  asins: string[];
}
```

**Incremental usage pattern:**

```typescript
// First run: fetch everything up to 5 pages
const first = await scraper.fetchPreSales();
const lastSeen = first.asins[0]; // save the first ASIN

// Next run: only fetch new ASINs (stop when reaching lastSeen)
const next = await scraper.fetchPreSales({ stopAtAsin: lastSeen });
console.log(`${next.asins.length} new pre-sale ASINs found`);
```

### `scraper.extractApplicableCouponProducts(couponInfo: IndividualCouponInfo, sourceAsin: string)`

Extracts the list of participating ASINs for an "applicable" coupon — a generic percentage-off coupon that applies automatically at checkout (no code required), detected when `IndividualCouponInfo.isApplicable` is `true`.

Two patterns are supported:

- **coupon-03** (`participatingProductsUrl` is `null`): no additional HTTP request. Returns an array containing only `sourceAsin`.
- **coupon-04** (`participatingProductsUrl` is set): fetches the coupon page, extracts the CSRF token, paginates through all participating ASINs, and returns the full list.

In both cases, fetches the coupon terms (`termsUrl`) to extract the expiration date. If terms are unavailable, `expiresAt` is `null` and the operation continues normally.

Returns `ApplicableCouponResult`:

```typescript
interface ApplicableCouponResult {
  asins: string[];          // Participating ASINs; always includes sourceAsin as fallback
  expiresAt: string | null; // e.g. "30/04/2026"; null when terms are unavailable
}
```

Built-in protections (same as `extractCouponProducts`):
- SSRF guard: `participatingProductsUrl` must be a valid `https://www.amazon.com.br` URL
- Pagination loop guard, ASIN deduplication, and configurable `maxProducts`/`maxPages` limits
- Degrade paths: network failures during product listing fall back to `[sourceAsin]`

### `IndividualCouponInfo`

Information extracted from an inline coupon shown directly on the product page. Individual coupons have no dedicated `/promotion/psp/` page when `isApplicable` is `false`; when `isApplicable` is `true`, they may have a participating products page.

```typescript
interface IndividualCouponInfo {
  promotionId: string;                        // Extracted from data-csa-c-item-id
  couponCode: string | null;                  // e.g. "VEMNOAPP"; null for applicable coupons
  discountText: string | null;                // Badge value: "R$20", "20%", etc. (v1.11.0+)
  description: string | null;                 // Cleaned message text without "off." prefix
  termsUrl: string | null;                    // URL to fetch coupon terms/conditions
  isIndividual: true;                         // Discriminant
  isApplicable?: boolean;                     // true for automatic checkout coupons (no code)
  participatingProductsUrl?: string | null;   // Coupon page URL (coupon-04); null when absent (coupon-03)
  discountPercent?: number | null;            // Numeric discount value, e.g. 10 for "10% off"
}
```

**Breaking change in v1.11.0:** Added `discountText` field. This field is `null` when the badge element is not found.

### `CouponMetadata`

Metadata extracted from the coupon promotion page. All fields are nullable because the page may not always display them.

```typescript
interface CouponMetadata {
  title: string | null;        // e.g. "Só no app: 20% off em itens Brinox"
  description: string | null;  // e.g. "Exclusivo para membros Prime"
  expiresAt: string | null;    // e.g. "domingo 15 de março de 2026"
}
```

### `Product`

```typescript
interface Product {
  asin: string;
  title: string;
  price: string;          // e.g. "R$ 49,90"
  originalPrice: string;  // e.g. "R$ 99,90"
  prime: boolean;
  rating: number;
  reviewCount: number;
  badge: string;
  url: string;
}
```

### Error Handling

The scraper throws `ScraperError` with typed codes:

| Code | When |
|------|------|
| `blocked` | HTTP 403 (after retry), 503, or CAPTCHA detected |
| `csrf_not_found` | Anti-CSRF token missing from coupon page HTML |
| `session_expired` | 403 persists during pagination after session refresh |
| `not_applicable_coupon` | `extractApplicableCouponProducts` called with `isApplicable !== true` |

```typescript
import { ScraperError } from 'amazing-scraper';

try {
  const page = await scraper.fetchProduct('B0EXAMPLE1');
  if (page.hasCoupon && page.couponInfo) {
    const result = await scraper.extractCouponProducts(page.couponInfo);
  }
} catch (err) {
  if (err instanceof ScraperError) {
    console.error(`Scraper error [${err.code}]:`, err.context);
  }
}
```

### Custom Logger

```typescript
import { createScraper, Logger } from 'amazing-scraper';

const myLogger: Logger = {
  info: (msg, ctx) => console.log(msg, ctx),
  warn: (msg, ctx) => console.warn(msg, ctx),
  error: (msg, ctx) => console.error(msg, ctx),
};

const scraper = createScraper({ logger: myLogger });
```

## Architecture

```
src/
  domain/
    entities/          Product, CouponInfo, CouponResult, CouponMetadata, IndividualCouponInfo, ApplicableCouponResult
    errors/            ScraperError
  application/
    ports/             HttpClient, HtmlParser, Logger
    use-cases/         FetchProduct, ExtractCouponProducts, FetchPreSales, FetchIndividualCouponTerms,
                       ExtractApplicableCouponProducts
  infrastructure/
    http/              AxiosHttpClient (axios + tough-cookie)
    parsers/           CheerioHtmlParser (cheerio)
    logger/            ConsoleLogger
  index.ts             Public API
```

The library follows Clean Architecture: the domain has no external dependencies, ports define interfaces, and infrastructure adapters implement them. All dependencies are injected via constructor.

## How It Works

### `fetchProduct` (Step 1)
1. **Fetch product page** — GET `/dp/{ASIN}` with browser-like headers
2. **Extract product data** — parse HTML for title, price, stock, coupon link, etc.
3. **Return `ProductPage`** — includes `couponInfo` when a coupon is detected

### `fetchPreSales`
1. **Build search URL** — appends `&page=N` to the HQ & Manga pre-sales base URL
2. **Extract ASINs** — parses `data-asin` from `s-search-result` elements on each page
3. **Paginate** — checks for a next-page link and fetches subsequent pages with a random delay
4. **Stop conditions** (checked in order): page limit reached, empty results page, stop-ASIN sentinel found, no next page link

### `extractCouponProducts` (Step 2)
1. **Fetch coupon page** — GET the coupon URL (built from `CouponInfo`), extract anti-CSRF token and coupon metadata (title, description, expiration)
2. **Paginate products** — POST to `/promotion/psp/productInfoList` with form-encoded payload; follows `sortId` for pagination with loop-guard and ASIN deduplication
3. **Return structured result** — maps raw API items to `Product[]`, includes `CouponMetadata`

Built-in protections:
- Random delay between requests (configurable)
- CAPTCHA detection (3 body markers)
- 403 retry with 5s backoff on initial page
- Session refresh on 403 during pagination
- Infinite pagination loop guard via `sortId` comparison
- ASIN deduplication across pages (stops on API cycling)
- Configurable `maxProducts` (default: 1000) and `maxPages` (default: 500) limits

## Testing

```bash
npm test              # run all tests
npm run test:coverage # with coverage report
npm run test:watch    # watch mode
```

## Limitations

- **Session expiration** — the CSRF token and session cookies expire. Long-running extractions with many pages may fail mid-pagination. The library attempts one session refresh before aborting.
- **Selector fragility** — Amazon may change coupon link patterns, CSRF token placement, or API response format without notice. This will require updating the parser.
- **Login-required coupons** — coupons that require authentication redirect to the sign-in page. The library does not support authenticated sessions and will return `{ found: false }` or fail.
- **Terms of Service** — high-volume automated access violates Amazon's Terms of Service. Use responsibly.
- **CAPTCHA** — Amazon may serve CAPTCHA pages (HTTP 200) instead of content. The library detects this and throws `ScraperError('blocked')`, but cannot solve CAPTCHAs.

## Documentation

- [Wiki](https://github.com/itsmaneka/amazing-scraper/wiki) — Architecture, API Reference, Changelog
- [Contributing](CONTRIBUTING.md) — How to contribute, commit conventions, development setup

## License

MIT
