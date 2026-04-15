# amazing-scraper

Biblioteca npm para scraping da Amazon Brasil. Publicado como `amazing-scraper`.

## API publica

```typescript
import { createScraper } from 'amazing-scraper';
const scraper = createScraper();

await scraper.fetchProduct('ASIN');
await scraper.extractCouponProducts(couponInfo);
await scraper.fetchPreSales({ stopAtAsin: 'ASIN_ULTIMO' });
```

## Arquitetura (Clean Architecture)

```
src/
  domain/entities/       Product, ProductPage, CouponInfo, CouponResult
  domain/errors/         ScraperError
  application/ports/     HttpClient, HtmlParser, Logger, RetryPolicy
  application/use-cases/ FetchProduct, ExtractCouponProducts, FetchPreSales, FetchIndividualCouponTerms
  infrastructure/
    http/                AxiosHttpClient, RotatingUserAgentProvider
    parsers/             CheerioHtmlParser
    logger/              ConsoleLogger
    retry/               ExponentialBackoffRetry
```

Decisoes por feature em `.claude/architecture/`. Padroes de parsing/ReDoS/fixtures em `.claude/agent-memory/scraper-developer/`.

## Mapeamento para GibiPromo

| amazing-scraper | GibiPromo Product |
|-----------------|-------------------|
| `asin` | `id` (PK) |
| `price` (string) | `price` (number, precisa parsing) |
| `fullPrice` (string) | `full_price` (number) |
| `inStock`, `isPreOrder` | `in_stock`, `preorder` |
| `imageUrl` | `image` |
| `hasCoupon`, `couponInfo` | `coupon` (via CouponScrapingService) |

Tag de afiliado NAO e aplicada aqui — responsabilidade do consumidor (`AmazonScraperFallbackClient`).

## Convencoes

- TypeScript strict, Clean Architecture, SOLID
- Testes com nock (mock HTTP)
- Conventional commits + semantic-release
- 95%+ cobertura de testes

## Comandos

```bash
npm test              # Jest + nock
npm run build         # tsc
npm run lint          # ESLint
npm run docs          # TypeDoc
```

## Indice

- [Skills](skills/INDEX.md) — add-scraper, run-tests

Agente `scraper-developer` e global do workspace.
