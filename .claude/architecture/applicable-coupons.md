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

## Integração

- **F03 (applicable-scraper-pipeline)**: consome `participatingProductsUrl` para navegar à página do cupom e extrair ASINs participantes
- **F04 (applicable-classify-and-persist)**: detecta `isApplicable === true` em `CouponScrapingService` e despacha para `processSingleApplicableCoupon`; usa `discountPercent` diretamente (sem passar por `classifyDiscount`)

## Gotchas

- **Fixture coupon-04 sintética** (`tests/fixtures/coupons/applicable/product-coupon-04.html`): href trocado para `/promotion/applicable/` para isolar o fluxo applicable. O fixture real (`product-coupon-04-real.html`) mantém `/promotion/psp/` intacto e é usado para regressão do bug de precedência.
- **Release**: F02 não faz `npm publish` sozinha; release é consolidada com F03 e F06 em uma única versão (ex: `1.12.0`).
- **`discountPercent` vs `discountText`**: applicable retorna apenas `discountPercent` (número inteiro); `discountText` pode ser `null` ou omitido — F04 usa o inteiro diretamente.
