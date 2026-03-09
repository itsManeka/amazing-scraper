# Architecture

The library follows **Clean Architecture** principles: the domain has no external dependencies, ports define interfaces, and infrastructure adapters implement them. All dependencies are injected via constructor.

## Module Structure

```
src/
  domain/
    entities/          Product, CouponInfo, CouponResult, CouponMetadata, FetchPreSalesResult
    errors/            ScraperError
  application/
    ports/             HttpClient, HtmlParser, Logger, RetryPolicy, UserAgentProvider
    use-cases/         FetchProduct, ExtractCouponProducts, FetchPreSales
  infrastructure/
    http/              AxiosHttpClient (axios + tough-cookie), RotatingUserAgentProvider
    parsers/           CheerioHtmlParser (cheerio)
    logger/            ConsoleLogger
    retry/             ExponentialBackoffRetry
  index.ts             Public API and factory (createScraper)
```

## Layers

### Domain

Pure entities and error types with no external dependencies. Defines the core data structures (`Product`, `CouponInfo`, `CouponResult`, `CouponMetadata`, `FetchPreSalesResult`) and error codes (`ScraperError`).

### Application

Use cases that orchestrate business logic and port interfaces that define contracts for infrastructure adapters:

- **FetchProduct** — fetches a single product page and extracts structured data
- **ExtractCouponProducts** — paginates through coupon promotion API to collect all participating products
- **FetchPreSales** — paginates through HQ & Manga pre-sale search pages to collect ASINs
- **Ports** — `HttpClient`, `HtmlParser`, `Logger`, `RetryPolicy`, `UserAgentProvider`

### Infrastructure

Concrete implementations of the port interfaces:

- **AxiosHttpClient** — HTTP client with cookie jar support (axios + tough-cookie)
- **CheerioHtmlParser** — HTML parsing and data extraction (cheerio)
- **ConsoleLogger** — default logger implementation
- **ExponentialBackoffRetry** — retry policy with exponential backoff
- **RotatingUserAgentProvider** — rotates browser User-Agent strings

## Data Flow

### fetchProduct

1. GET `/dp/{ASIN}` with browser-like headers
2. Parse HTML for title, price, stock status, coupon link, and more
3. Return `ProductPage` (includes `couponInfo` when coupon is detected)

### extractCouponProducts

1. GET coupon page, extract anti-CSRF token and metadata
2. POST to `/promotion/psp/productInfoList` with pagination
3. Deduplicate ASINs and guard against infinite loops
4. Return `CouponResult` with all products and metadata

### fetchPreSales

1. Build search URL for HQ & Manga pre-sales category
2. Extract `data-asin` from search result elements
3. Paginate with random delays between requests
4. Stop on: page limit, empty results, stop-ASIN sentinel, or no next page

## Built-in Protections

- Random delay between requests (configurable)
- CAPTCHA detection (3 body markers)
- 403 retry with backoff on initial page
- Session refresh on 403 during pagination
- Infinite pagination loop guard via `sortId` comparison
- ASIN deduplication across pages
- Configurable `maxProducts` (1000) and `maxPages` (500) limits
