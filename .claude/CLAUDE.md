# amazing-scraper

Biblioteca npm publica (`amazing-scraper`) de scraping da Amazon Brasil: pagina de produto, cupons e pre-vendas de
HQ/manga. Uso e API publica: [README](../README.md).

## Arquitetura

Clean Architecture, dependencia sempre para dentro:

- `domain/` — entidades, erros e mappers; sem I/O.
- `application/` — use cases e portas (HTTP, parser HTML, logger, retry, user agent).
- `infrastructure/` — adapters das portas (axios, cheerio, backoff, logger de console).
- `index.ts` — unica superficie publica; a factory monta os adapters.

Use case novo depende so de porta; adapter novo implementa uma porta existente ou uma nova em `application/ports/`.
Logs pela porta `Logger`, nunca `console.*` fora do adapter de console.

## Testes

- Jest em `tests/` (unit e integracao), com paginas HTML salvas como fixture; HTTP sempre mockado nos testes.
- Cobertura minima de 80% (branches, functions, lines, statements) no `jest.config.js`; o CI (`test:ci`) reprova abaixo.
- `maxWorkers: 1` no config: testes sempre sequenciais.

## Release

- semantic-release em push na `main`: versao, CHANGELOG e tag saem dos conventional commits (commitlint + husky).
- Publicacao no npm por Trusted Publishing (OIDC), sem token.
- Nao edite `version` nem `CHANGELOG.md` a mao.
- O pacote publica so `dist/`, README e LICENSE.

## Comandos

```bash
npm test               # Jest
npm run test:coverage  # com limiar de 80%
npm run lint
npm run build          # tsc (limpa dist antes)
npm run example-product  # exemplos em examples/ via tsx (rede real)
```

Nao ha script `typecheck`: o `build` e o que roda o `tsc`.
