# amazing-scraper

Biblioteca npm para scraping da Amazon Brasil. Publicado como `amazing-scraper`. Versão atual: `1.4.0`.

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
  domain/entities/       Product, ProductPage, CouponInfo (couponCode: string | null), CouponResult
  domain/errors/         ScraperError
  application/ports/     HttpClient, HtmlParser, Logger, RetryPolicy
  application/use-cases/ FetchProduct, ExtractCouponProducts, FetchPreSales
  infrastructure/
    http/                AxiosHttpClient, RotatingUserAgentProvider
    parsers/             CheerioHtmlParser (extractCouponCode via regex /com o cupom\s+([A-Z0-9]{6,})/i)
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
| `hasCoupon`, `couponInfo` | `coupon` (via CouponScrapingService) — tipo PRODUCT_LINKED |
| `couponInfo.couponCode` | `coupon.coupon_code` (codigo alfanumerico, ex: "FJOVKLWWIZXM") |
| `individualCouponInfo` (F17) | `coupon` (via CouponScrapingService) — tipo INDIVIDUAL, sem vinculacao a produtos |

## Comandos

```bash
npm test              # Jest + nock
npm run build         # TypeScript compiler
npm run lint          # ESLint
npm run docs          # TypeDoc
```

## Alinhamento com PA-API (desde 1.4.0)

`fetchProduct` retorna campos compatíveis com o que a PA-API retorna no gibipromo, permitindo uso como fallback transparente:

| Campo | Comportamento |
|-------|--------------|
| `contributors` | Apenas nomes — sem role entre parênteses (igual a `c.Name` da PA-API) |
| `imageUrl` | Normalizada para `._SL500_` via `normalizeAmazonImageUrl` (exportada) |
| `inStock` | `!!offerId && !isOutOfStock` — mesma lógica da PA-API |

A tag de afiliado **não** é aplicada aqui — responsabilidade do consumidor (`AmazonScraperFallbackClient` no gibipromo).

## Convencoes

- TypeScript strict, Clean Architecture, SOLID
- Testes com nock (mock HTTP)
- Conventional commits + semantic-release
- 95%+ cobertura de testes

## Indice

- [Skills](skills/INDEX.md) — add-scraper, run-tests

Agente `scraper-developer` e global do workspace.
