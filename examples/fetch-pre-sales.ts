import { createScraper, ScraperError } from '../src/index';

const STOP_ASIN = process.argv[2] || undefined;
const LIMIT = process.argv[3] ? parseInt(process.argv[3], 10) : undefined;

async function main(): Promise<void> {
  const scraper = createScraper({
    delayMs: { min: 1500, max: 2500 },
  });

  process.stdout.write('\n=== Buscando pré-vendas de HQs e Mangás ===\n\n');

  if (STOP_ASIN) {
    process.stdout.write(`ASIN de parada : ${STOP_ASIN}\n`);
  }
  if (LIMIT) {
    process.stdout.write(`Limite de páginas: ${LIMIT}\n`);
  }
  process.stdout.write('\n');

  const result = await scraper.fetchPreSales({
    stopAtAsin: STOP_ASIN,
    limit: LIMIT,
  });

  if (result.asins.length === 0) {
    process.stdout.write('Nenhum ASIN novo encontrado.\n');
    return;
  }

  process.stdout.write(`Total de ASINs encontrados: ${result.asins.length}\n\n`);
  process.stdout.write('--- ASINs ---\n\n');

  for (let i = 0; i < result.asins.length; i++) {
    process.stdout.write(`  ${String(i + 1).padStart(3, ' ')}. ${result.asins[i]}\n`);
  }

  process.stdout.write(`\nPrimeiro ASIN (usar como stopAtAsin na próxima execução): ${result.asins[0]}\n`);
  process.stdout.write('\n=== Fim ===\n');
}

main().catch((err: unknown) => {
  if (err instanceof ScraperError) {
    process.stderr.write(`\nErro do scraper [${err.code}]\n`);
    if (err.context) {
      process.stderr.write(`Contexto: ${JSON.stringify(err.context, null, 2)}\n`);
    }
  } else {
    process.stderr.write(`\nErro inesperado: ${err}\n`);
  }
  process.exit(1);
});
