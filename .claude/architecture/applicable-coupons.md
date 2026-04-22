# Applicable Coupons — Detecção e Extração

## Contexto

"Applicable coupons" são cupons genéricos exibidos na Amazon com o texto "Aplicar cupom de X% [Ver Itens Participantes] | Termos", sem código explícito no bloco do produto. Diferem dos cupons individuais clássicos ("Insira o código X") e dos cupons PSP (link `/promotion/psp/`).

Dois padrões identificados:
- **coupon-03**: "Aplicar cupom de X% Termos" — sem lista de participantes (ex: promotionId `AF12ZU9VE9JOE`, 10% off)
- **coupon-04**: "Aplicar cupom de X% Ver Itens Participantes | Termos" — com link para página do cupom PSP (ex: `A227SUYAFEZIRF`, 15% off)

## Regras

**Ponto de entrada**: `extractIndividualCouponInfo` — dentro do `.each()` sobre `[data-csa-c-owner="PromotionsDiscovery"][data-csa-c-item-id*="amzn1.promotion."]`.

**Precedência dentro do container**:
1. Clássico: "Insira o código X" → retorna `IndividualCouponInfo` com `couponCode` preenchido
2. Applicable: "Aplicar cupom de X%" (sem código) → retorna com `isApplicable: true`
3. Nenhum padrão → null (filtro anti-falso-positivo descarta pre-order e promos informativas)

**Bug crítico de precedência (resolvido em F02)**: applicable coupons do tipo coupon-04 têm o link "Ver Itens Participantes" apontando para `/promotion/psp/<promotionId>`. Sem a correção, `extractCouponInfo` (Patterns 1-5) detectaria o PSP antes de `extractIndividualCouponInfo` ser chamado. A solução: `extractCouponInfo` computa um `Set<string> applicablePromotionIds` — containers `PromotionsDiscovery` com "Aplicar cupom de X%" — e os Patterns 1-3 e 5 pulam qualquer `promotionId` nesse Set.

**Campos retornados em applicable**:
- `isApplicable: true`
- `discountPercent: number` — inteiro extraído via `/Aplicar\s+cupom\s+de\s+(\d{1,2})%/i`
- `participatingProductsUrl: string | null` — href de "Ver Itens Participantes" (null se ausente)
- `termsUrl: string | undefined` — reutiliza lógica existente (JSON `data-a-modal`)
- `couponCode: null` — código está na página do cupom, responsabilidade de F03

**`IndividualCouponInfo` (campos opcionais adicionados em F02)**:
```ts
isApplicable?: boolean
participatingProductsUrl?: string | null
discountPercent?: number | null
```
Campos ausentes/`undefined` no fluxo clássico — extensão retrocompatível.

## Extração de ASINs participantes — `ExtractApplicableCouponProducts`

Use case em `src/application/use-cases/ExtractApplicableCouponProducts.ts`. Exposto via `createScraper()` como `scraper.extractApplicableCouponProducts(couponInfo, sourceAsin)`. Retorna `ApplicableCouponResult`:

```ts
interface ApplicableCouponResult {
  asins: string[];          // sempre inclui sourceAsin como fallback mínimo
  expiresAt: string | null; // formato "dd/MM/yyyy"; null se termsUrl falhar
}
```

**Fluxo coupon-03** (`participatingProductsUrl === null`):
1. Chama `FetchIndividualCouponTerms.execute(termsUrl)` → texto dos termos
2. Chama `htmlParser.extractIndividualCouponExpiration(termsText)` → data
3. Retorna `{ asins: [sourceAsin], expiresAt }` — zero requests adicionais de listagem

**Fluxo coupon-04** (`participatingProductsUrl !== null`):
1. SSRF guard: valida que a URL é `https://www.amazon.com.br` (rejeita `http:`, hostnames externos)
2. GET na página do cupom → extrai CSRF token (obrigatório; lança `ScraperError('csrf_not_found')` se ausente)
3. Busca termos em paralelo lógico (via `termsUrl`)
4. Loop de paginação: POST em `/promotion/psp/productInfoList` com CSRF; acumula ASINs; break por `reachBottom`, `sortId` cycling, `maxPages` ou `maxProducts`
5. Se lista vazia após paginação: fallback `[sourceAsin]`
6. Retorna `{ asins, expiresAt }`

**Degrade paths** (sem lançar exceção):
- `termsUrl` ausente ou com erro HTTP → `expiresAt: null`
- `participatingProductsUrl` falha de rede → fallback `[sourceAsin]` + log `warn`
- SSRF guard rejeita URL → fallback `[sourceAsin]` + log `warn`

**Precondicão**: `couponInfo.isApplicable !== true` → lança `ScraperError('not_applicable_coupon')` (erro de programação, não evento Amazon — não aciona `onBlocked`).

### Parser de expiração — `extractIndividualCouponExpiration`

Método em `HtmlParser` port e `CheerioHtmlParser`. Recebe **texto já parseado** (saída de `FetchIndividualCouponTerms`), não HTML. Regex ancorada na estrutura de data PT-BR:

```
/ate\s+(\d{1,2}\s+de\s+[a-zç]+\s+de\s+\d{4}(?:\s+as\s+\d{1,2}:\d{2})?)/gi
```

Guard de comprimento: retorna `null` se `termsText.length > 10_000` (defesa contra ReDoS em inputs patológicos). Normaliza acentos (`até` → `ate`, `às` → `as`) antes do match.

## Integração

- **`CouponScrapingService` (telegram-bot, F04)**: detecta `isApplicable === true`, chama `scraper.extractApplicableCouponProducts(couponInfo, sourceAsin)` e persiste com `discount_type=PERCENTAGE`, `is_applicable=true`, `participating_asins` populado.
- **`HtmlParser` port**: todos os `jest.Mocked<HtmlParser>` precisam incluir `extractIndividualCouponExpiration: jest.fn().mockReturnValue(null)` (campo obrigatório no port).

## Gotchas

- **Fixture coupon-04 sintética** (`tests/fixtures/coupons/applicable/product-coupon-04.html`): href trocado para `/promotion/applicable/` para isolar o fluxo applicable. O fixture real (`product-coupon-04-real.html`) mantém `/promotion/psp/` intacto e é usado para regressão do bug de precedência.
- **Release**: F02, F03 e F06 não fazem `npm publish` individualmente; release é consolidada em uma única versão (ex: `1.12.0`).
- **`discountPercent` vs `discountText`**: applicable retorna apenas `discountPercent` (número inteiro); `discountText` pode ser `null` — F04 usa o inteiro diretamente, sem passar por `classifyDiscount`.
- **Paginação duplicada** (débito técnico): `ExtractApplicableCouponProducts` duplica a lógica de paginação de `ExtractCouponProducts`. Refatoração em helper compartilhado foi adiada por risco de regressão — documentar e endereçar em feature futura.
- **`http:` rejeitado no SSRF guard**: `resolveAndValidateUrl` aceita apenas `https:`. URLs `http://www.amazon.com.br` resultam em degrade (fallback `sourceAsin`), não em erro.
