import { createScraper, ScraperError } from '../src/index';

const ASIN = process.argv[2];

if (!ASIN) {
  process.stderr.write(
    'Uso: npx tsx examples/extract-coupon.ts <ASIN>\n' +
    'Exemplo: npx tsx examples/extract-coupon.ts B0DFB3RY3Q\n',
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const scraper = createScraper({
    delayMs: { min: 1500, max: 2500 },
  });

  process.stdout.write(`\n=== Consultando produto ${ASIN} ===\n\n`);

  const page = await scraper.fetchProduct(ASIN);
  process.stdout.write(`Título: ${page.title || '(não encontrado)'}\n`);
  process.stdout.write(`Preço : ${page.price || '(não encontrado)'}\n`);

  if (!page.hasCoupon || !page.couponInfo) {
    process.stdout.write(`\nNenhum cupom encontrado para o ASIN ${ASIN}.\n`);
    return;
  }

  process.stdout.write(`\nCupom detectado — extraindo produtos...\n\n`);

  const result = await scraper.extractCouponProducts(page.couponInfo);

  const { promotionId, sourceAsin, totalProducts, products, metadata } = result;

  process.stdout.write(`Cupom encontrado!\n`);
  process.stdout.write(`  Promotion ID : ${promotionId}\n`);
  process.stdout.write(`  ASIN origem  : ${sourceAsin}\n`);
  process.stdout.write(`  Título       : ${metadata?.title ?? '(não disponível)'}\n`);
  process.stdout.write(`  Descrição    : ${metadata?.description ?? '(não disponível)'}\n`);
  process.stdout.write(`  Expiração    : ${metadata?.expiresAt ?? '(não disponível)'}\n`);
  process.stdout.write(`  Total produtos: ${totalProducts}\n\n`);

  process.stdout.write('--- Produtos participantes ---\n\n');

  for (const product of products) {
    process.stdout.write(`[${product.asin}] ${product.title}\n`);
    process.stdout.write(`  Preço      : ${product.price}`);
    if (product.originalPrice) {
      process.stdout.write(` (de ${product.originalPrice})`);
    }
    process.stdout.write('\n');
    process.stdout.write(`  Prime      : ${product.prime ? 'Sim' : 'Não'}\n`);
    process.stdout.write(`  Avaliação  : ${product.rating} (${product.reviewCount} avaliações)\n`);
    if (product.badge) {
      process.stdout.write(`  Badge      : ${product.badge}\n`);
    }
    process.stdout.write(`  URL        : ${product.url}\n`);
    process.stdout.write('\n');
  }

  process.stdout.write(`=== Fim — ${totalProducts} produtos listados ===\n`);
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
