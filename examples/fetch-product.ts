import { createScraper, ScraperError } from '../src/index';

const ASIN = process.argv[2];

if (!ASIN) {
  process.stderr.write(
    'Uso: npx tsx examples/fetch-product.ts <ASIN>\n' +
    'Exemplo: npx tsx examples/fetch-product.ts B0DFB3RY3Q\n',
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const scraper = createScraper();

  process.stdout.write(`\n=== Consultando produto ${ASIN} ===\n\n`);

  const page = await scraper.fetchProduct(ASIN);

  process.stdout.write(`Título      : ${page.title || '(não encontrado)'}\n`);
  process.stdout.write(`ASIN        : ${page.asin}\n`);
  process.stdout.write(`Preço       : ${page.price || '(não encontrado)'}`);
  if (page.originalPrice) {
    process.stdout.write(` (de ${page.originalPrice})`);
  }
  process.stdout.write('\n');
  process.stdout.write(`Prime       : ${page.prime ? 'Sim' : 'Não'}\n`);
  process.stdout.write(`Avaliação   : ${page.rating} (${page.reviewCount} avaliações)\n`);
  process.stdout.write(`Em estoque  : ${page.inStock ? 'Sim' : 'Não'}\n`);
  process.stdout.write(`Pré-venda   : ${page.isPreOrder ? 'Sim' : 'Não'}\n`);
  process.stdout.write(`Formato     : ${page.format ?? '(não disponível)'}\n`);
  process.stdout.write(`Editora     : ${page.publisher ?? '(não disponível)'}\n`);
  process.stdout.write(`Grupo       : ${page.productGroup ?? '(não disponível)'}\n`);
  process.stdout.write(`Imagem      : ${page.imageUrl ?? '(não disponível)'}\n`);
  process.stdout.write(`Offer ID    : ${page.offerId ?? '(não disponível)'}\n`);

  if (page.contributors && page.contributors.length > 0) {
    process.stdout.write(`Contribuidores:\n`);
    for (const c of page.contributors) {
      process.stdout.write(`  - ${c}\n`);
    }
  }

  process.stdout.write(`Tem cupom   : ${page.hasCoupon ? 'Sim' : 'Não'}\n`);

  if (page.hasCoupon && page.couponInfo) {
    process.stdout.write(`  Promotion ID       : ${page.couponInfo.promotionId}\n`);
    process.stdout.write(`  Redirect ASIN      : ${page.couponInfo.redirectAsin}\n`);
    process.stdout.write(`  Redirect Merchant  : ${page.couponInfo.redirectMerchantId}\n`);
  }

  process.stdout.write(`URL         : ${page.url}\n`);
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
