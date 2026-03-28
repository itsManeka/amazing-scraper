import { parseAmazonPrice, toAmazonProduct } from '../../src/domain/mappers/toAmazonProduct';
import { ProductPage } from '../../src/domain/entities';
import { ScraperError } from '../../src/domain/errors';

// ---------- parseAmazonPrice ----------

describe('parseAmazonPrice', () => {
  it('converte preço padrão', () => {
    expect(parseAmazonPrice('R$ 49,90')).toBe(49.9);
  });

  it('converte preço com separador de milhar', () => {
    expect(parseAmazonPrice('R$ 1.299,90')).toBe(1299.9);
  });

  it('converte preço sem centavos', () => {
    expect(parseAmazonPrice('R$ 100,00')).toBe(100);
  });

  it('retorna 0 para string vazia', () => {
    expect(parseAmazonPrice('')).toBe(0);
  });

  it('retorna 0 para string inválida', () => {
    expect(parseAmazonPrice('indisponível')).toBe(0);
  });
});

// ---------- toAmazonProduct ----------

const BASE_PAGE: ProductPage = {
  asin: 'B0TEST1',
  title: 'Produto Teste',
  price: 'R$ 99,90',
  originalPrice: 'R$ 149,90',
  prime: true,
  rating: 4.5,
  reviewCount: 100,
  hasCoupon: false,
  couponInfo: null,
  url: 'https://www.amazon.com.br/dp/B0TEST1',
  offerId: 'A1ZZFT5FULY4LN',
  inStock: true,
  imageUrl: 'https://m.media-amazon.com/images/I/71example.jpg',
  isPreOrder: false,
  format: 'Capa dura',
  publisher: 'Editora Exemplo',
  contributors: ['Autor Exemplo'],
  productGroup: 'Book',
};

describe('toAmazonProduct', () => {
  it('converte preços de string para number', () => {
    const product = toAmazonProduct(BASE_PAGE);
    expect(product.currentPrice).toBe(99.9);
    expect(product.fullPrice).toBe(149.9);
  });

  it('copia campos diretos corretamente', () => {
    const product = toAmazonProduct(BASE_PAGE);
    expect(product.offerId).toBe('A1ZZFT5FULY4LN');
    expect(product.title).toBe('Produto Teste');
    expect(product.inStock).toBe(true);
    expect(product.isPreOrder).toBe(false);
    expect(product.imageUrl).toBe('https://m.media-amazon.com/images/I/71example.jpg');
    expect(product.url).toBe('https://www.amazon.com.br/dp/B0TEST1');
    expect(product.format).toBe('Capa dura');
    expect(product.publisher).toBe('Editora Exemplo');
    expect(product.contributors).toEqual(['Autor Exemplo']);
    expect(product.productGroup).toBe('Book');
  });

  it('usa currentPrice como fullPrice quando originalPrice é null', () => {
    const page = { ...BASE_PAGE, originalPrice: null };
    const product = toAmazonProduct(page);
    expect(product.fullPrice).toBe(product.currentPrice);
    expect(product.fullPrice).toBe(99.9);
  });

  it('retorna imageUrl vazia quando ausente no ProductPage', () => {
    const page = { ...BASE_PAGE, imageUrl: undefined };
    const product = toAmazonProduct(page);
    expect(product.imageUrl).toBe('');
  });

  it('repassa offerId undefined quando produto fora de estoque', () => {
    const page = { ...BASE_PAGE, offerId: undefined, inStock: false };
    const product = toAmazonProduct(page);
    expect(product.offerId).toBeUndefined();
    expect(product.inStock).toBe(false);
  });

  it('repassa campos opcionais como undefined quando ausentes', () => {
    const page: ProductPage = {
      ...BASE_PAGE,
      format: undefined,
      publisher: undefined,
      contributors: undefined,
      productGroup: undefined,
    };
    const product = toAmazonProduct(page);
    expect(product.format).toBeUndefined();
    expect(product.publisher).toBeUndefined();
    expect(product.contributors).toBeUndefined();
    expect(product.productGroup).toBeUndefined();
  });

  it('não inclui campos extras do ProductPage (prime, rating, etc.)', () => {
    const product = toAmazonProduct(BASE_PAGE);
    expect('prime' in product).toBe(false);
    expect('rating' in product).toBe(false);
    expect('reviewCount' in product).toBe(false);
    expect('hasCoupon' in product).toBe(false);
    expect('couponInfo' in product).toBe(false);
    expect('asin' in product).toBe(false);
  });

  it('lança ScraperError com code price_not_found quando price é null', () => {
    const page: ProductPage = { ...BASE_PAGE, price: null };
    expect(() => toAmazonProduct(page)).toThrow(ScraperError);
    try {
      toAmazonProduct(page);
    } catch (err) {
      expect(err).toBeInstanceOf(ScraperError);
      expect((err as ScraperError).code).toBe('price_not_found');
      expect((err as ScraperError).context).toEqual({ asin: BASE_PAGE.asin });
    }
  });

  it('retorna currentPrice: 0 para produto gratuito com price R$ 0,00', () => {
    const page: ProductPage = { ...BASE_PAGE, price: 'R$ 0,00', originalPrice: null };
    const product = toAmazonProduct(page);
    expect(product.currentPrice).toBe(0);
  });

  it('retorna currentPrice: 49.9 para price R$ 49,90', () => {
    const page: ProductPage = { ...BASE_PAGE, price: 'R$ 49,90', originalPrice: null };
    const product = toAmazonProduct(page);
    expect(product.currentPrice).toBe(49.9);
  });
});
