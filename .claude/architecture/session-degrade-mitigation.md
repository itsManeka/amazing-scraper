# Session Degrade Mitigation

## Contexto

A Amazon responde com HTTP 200 OK mas entrega HTML degradado (sem `<title>`, sem `#productTitle`, sem price selectors, sem containers `[data-csa-c-owner="PromotionsDiscovery"]`) após 1-3 requests consecutivas no mesmo `CookieJar`. O scraper interpreta essa resposta como `ScraperError('price_not_found')`, e lotes de 10+ ASINs terminam com 0 produtos processados. Não é bloqueio de IP — uma nova sessão (`createScraper()` novo por ASIN) funciona normalmente.

Mitigação híbrida ativa por padrão: reciclagem preventiva a cada N requests + detecção reativa com 1 retry.

## Regras

### Detecção de degrade (`isDegradedProductPage(html): boolean`)

Retorna `true` quando os **dois** sinais estão presentes simultaneamente:
1. `#productTitle` ausente ou vazio
2. **Todos** os price selectors ausentes: `#priceblock_ourprice`, `#priceblock_dealprice`, `#priceblock_saleprice`, `.a-price .a-offscreen`, `span.a-price[data-a-size=xl] .a-offscreen`, `#corePrice_feature_div .a-offscreen`, **e** `[data-csa-c-owner="PromotionsDiscovery"]`

A condição sobre `<title>` foi removida: páginas anti-bot da Amazon servem `<title>` **preenchido** com o nome real do produto ("AUXOM Potes Herméticos... | Amazon.com.br") enquanto omitem `#productTitle` e todos os price selectors — portanto `<title>` não é discriminador. Validado empiricamente em 5 HTMLs reais capturados.

Falso-positivo em produto out-of-stock não ocorre porque páginas reais (mesmo sem estoque) sempre têm `#productTitle` preenchido.

### SessionRecycler (reciclagem preventiva)

- Conta requests bem-sucedidas via `recordRequest()` após cada HTTP GET/POST nos 4 use cases: `FetchProduct`, `FetchPreSales`, `ExtractCouponProducts`, `ExtractApplicableCouponProducts`.
- Quando contador ≥ `afterRequests`, chama `httpClient.resetSession?.()` e zera o contador — novo `CookieJar` + nova instância axios.
- `FetchIndividualCouponTerms` não recebe recycler (one-shot, herda sessão do pai).
- `afterRequests = 0`: recycler inerte (legacy mode).

### Detecção reativa em FetchProduct

- Após receber HTML, chama `assertNoCaptcha` (1ª barreira) e depois `isDegradedProductPage`.
- Se degradado, `httpClient.resetSession?.()` deve existir — caso contrário loga warn e segue para o parser normalmente.
- **1 retry único** com UA fresco; `SessionRecycler.resetCounter()` é chamado para evitar double-recycling preventivo imediato.
- Resposta do retry também passa por `assertNoCaptcha` — CAPTCHA no retry gera `ScraperError('blocked')` corretamente.
- Se retry também degradado: parser processa normalmente e gera `ScraperError('price_not_found')`.
- Controlado por `ScraperOptions.sessionRecycle.reactive` (default `true`).

### HttpClient.resetSession?()

Método opcional no port `HttpClient`. Implementado em `AxiosHttpClient` (recria `CookieJar` e instância axios atomicamente). Ausência no port não quebra consumers com `HttpClient` customizado — todos os call-sites usam optional chaining `resetSession?.()`.

## Integração

`createScraper(options?)` instancia **um único `SessionRecycler`** compartilhado entre os 4 use cases. O contador captura requests de qualquer use case, evitando que interleaving contorne o threshold.

```typescript
// Mitigação ativa (padrão):
const scraper = createScraper();

// Só reciclagem preventiva, sem reactive:
const scraper = createScraper({ sessionRecycle: { reactive: false } });

// Threshold maior:
const scraper = createScraper({ sessionRecycle: { afterRequests: 10 } });

// Comportamento pré-mitigação:
const scraper = createScraper({ sessionRecycle: { afterRequests: 0, reactive: false } });
```

## Gotchas

- **UA por request, não por sessão**: `RotatingUserAgentProvider.get()` é chamado em cada `execute()`, não no construtor. Alterar o provider padrão por um que retorna UA fixo preserva o comportamento, mas reduz a eficácia da rotação.
- **Retry sem reset = ineficaz**: se `httpClient.resetSession` não existe (HttpClient customizado antigo), degrade é detectado mas não há retry — a detecção reativa é no-op. O log warn indica `"resetSession required for reactive retry"`.
- **Cyclic reset**: `SessionRecycler.resetCounter()` é chamado pelo retry reativo para evitar que a reciclagem preventiva dispare logo após um reset reativo (evita double-recycling).
- **CAPTCHA vs degrade**: `assertNoCaptcha` precede `isDegradedProductPage` na request original e na resposta do retry — ordem importa. CAPTCHA é identificado por marcadores HTML específicos antes da checagem de degrade.
