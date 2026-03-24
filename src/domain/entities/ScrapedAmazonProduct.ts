/**
 * Dados do produto extraídos por scraping, com a mesma forma retornada
 * pela Amazon PA-API. Permite usar o amazing-scraper como fallback da PA-API.
 *
 * Mapeamento dos campos de `ProductPage`:
 * - `price` (string "R$ X,XX") → `currentPrice` (number)
 * - `originalPrice` (string "R$ X,XX") → `fullPrice` (number)
 * - Demais campos são copiados diretamente.
 */
export interface ScrapedAmazonProduct {
  /** Merchant ID do vendedor da buy-box (ausente quando fora de estoque). */
  offerId?: string;
  /** Título do produto. */
  title: string;
  /** Preço cheio (antes de desconto). Igual a `currentPrice` quando sem desconto. */
  fullPrice: number;
  /** Preço atual de venda. */
  currentPrice: number;
  /** Se o produto está disponível para compra imediata. */
  inStock: boolean;
  /** URL da imagem principal (string vazia quando indisponível). */
  imageUrl: string;
  /** Se o produto está disponível apenas como pré-venda. */
  isPreOrder: boolean;
  /** URL da página do produto na Amazon. */
  url: string;
  /** Formato/encadernação (ex: "Capa dura", "Capa Comum", "Kindle"). */
  format?: string;
  /** Editora (ex: "Intrínseca", "Panini"). */
  publisher?: string;
  /** Lista de colaboradores com papéis (ex: ["Nome Autor (Autor)"]). */
  contributors?: string[];
  /** Grupo do produto seguindo convenção PA-API (ex: "Book", "DVD"). */
  productGroup?: string;
}
