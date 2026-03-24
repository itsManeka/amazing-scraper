import { ProductPage } from '../entities/ProductPage';
import { ScrapedAmazonProduct } from '../entities/ScrapedAmazonProduct';

/**
 * Converte uma string de preço em Real para número.
 *
 * @example
 * parseAmazonPrice("R$ 49,90")     // → 49.90
 * parseAmazonPrice("R$ 1.299,90")  // → 1299.90
 * parseAmazonPrice("")             // → 0
 */
export function parseAmazonPrice(formatted: string): number {
  if (!formatted) return 0;
  const cleaned = formatted
    .replace(/R\$\s*/, '')  // remove símbolo de moeda
    .replace(/\./g, '')     // remove separadores de milhar
    .replace(',', '.');     // troca separador decimal
  return parseFloat(cleaned) || 0;
}

/**
 * Mapeia um `ProductPage` do amazing-scraper para o formato `ScrapedAmazonProduct`,
 * compatível com a interface `AmazonProduct` da PA-API.
 *
 * Use esta função para implementar o fallback de scraping quando a PA-API
 * estiver indisponível (ex: antes de atingir o requisito de 10 vendas).
 *
 * @example
 * const scraper = createScraper();
 * const page = await scraper.fetchProduct('B0EXAMPLE1');
 * const product = toAmazonProduct(page);
 * // product agora tem currentPrice: number, fullPrice: number, etc.
 */
export function toAmazonProduct(page: ProductPage): ScrapedAmazonProduct {
  const currentPrice = parseAmazonPrice(page.price);
  const fullPrice = page.originalPrice
    ? parseAmazonPrice(page.originalPrice)
    : currentPrice;

  return {
    offerId: page.offerId,
    title: page.title,
    fullPrice,
    currentPrice,
    inStock: page.inStock,
    imageUrl: page.imageUrl ?? '',
    isPreOrder: page.isPreOrder,
    url: page.url,
    format: page.format,
    publisher: page.publisher,
    contributors: page.contributors,
    productGroup: page.productGroup,
  };
}
