# amazing-scraper

Biblioteca npm para scraping da Amazon Brasil. Publicado como `amazing-scraper`.

## API publica

```typescript
import { createScraper } from 'amazing-scraper';
const scraper = createScraper();

// Produto unico
const product = await scraper.fetchProduct('ASIN123');

// Cupons de uma promocao
const coupons = await scraper.extractCouponProducts(couponInfo);

// Pre-vendas de HQ/Manga
const preSales = await scraper.fetchPreSales({ stopAtAsin: 'ASIN_ULTIMO' });
```

## Arquitetura

Clean Architecture (domain -> application -> infrastructure).

```
src/
  domain/entities/       Product, ProductPage, CouponInfo, CouponResult
  domain/errors/         ScraperError
  application/ports/     HttpClient, HtmlParser, Logger, RetryPolicy
  application/use-cases/ FetchProduct, ExtractCouponProducts, FetchPreSales
  infrastructure/
    http/                AxiosHttpClient, RotatingUserAgentProvider
    parsers/             CheerioHtmlParser
    logger/              ConsoleLogger
    retry/               ExponentialBackoffRetry
```

## Mapeamento para GibiPromo

| amazing-scraper | GibiPromo Product |
|-----------------|-------------------|
| `asin` | `id` (PK) |
| `price` (string "R$ X,XX") | `price` (number, precisa parsing) |
| `fullPrice` (string) | `full_price` (number) |
| `inStock` | `in_stock` |
| `isPreOrder` | `preorder` |
| `imageUrl` | `image` |
| `hasCoupon`, `couponInfo` | (campo a ser adicionado) |

## Comandos

```bash
npm test              # Jest + nock
npm run build         # TypeScript compiler
npm run lint          # ESLint
npm run docs          # TypeDoc
```

## Convencoes

- TypeScript strict, Clean Architecture, SOLID
- Testes com nock (mock HTTP)
- Conventional commits + semantic-release
- 95%+ cobertura de testes
