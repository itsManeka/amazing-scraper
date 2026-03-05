/**
 * Represents a product listed under an Amazon coupon promotion.
 */
export interface Product {
  asin: string;
  title: string;
  price: string;
  originalPrice: string;
  prime: boolean;
  rating: number;
  reviewCount: number;
  badge: string;
  url: string;
}
