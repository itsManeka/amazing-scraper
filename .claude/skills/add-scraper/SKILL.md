---
name: add-scraper
description: Adiciona novo scraper/parser ao amazing-scraper
disable-model-invocation: true
argument-hint: "<funcionalidade>"
---

Adicione um novo scraper ao amazing-scraper.

Funcionalidade: $ARGUMENTS

## Checklist

1. Entidade em `src/domain/entities/` (se necessario)
2. Use case em `src/application/use-cases/`
3. Parser Cheerio em `src/infrastructure/parsers/`
4. Testes com nock em `tests/`
5. Export em `src/index.ts`
6. Exemplo de uso em `examples/`
