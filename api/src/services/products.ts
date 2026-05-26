import { env } from '../config/env.js';
import { listProducts, type ProductDto } from '../repositories/products.js';
import { getWithSingleFlight, type CacheStatus } from './cache.js';

const PRODUCTS_CACHE_KEY = 'products:list:v1';
const PRODUCTS_CACHE_PREFIX = 'products:list';

export interface ProductsResponse {
  products: ProductDto[];
  cacheStatus: CacheStatus;
}

export async function getProductsCatalog(): Promise<ProductsResponse> {
  const result = await getWithSingleFlight<ProductDto[]>({
    key: PRODUCTS_CACHE_KEY,
    keyPrefix: PRODUCTS_CACHE_PREFIX,
    ttlSeconds: env.PRODUCTS_CACHE_TTL_SECONDS,
    lockTtlSeconds: env.PRODUCTS_CACHE_LOCK_TTL_SECONDS,
    loader: listProducts,
  });
  return { products: result.value, cacheStatus: result.status };
}
