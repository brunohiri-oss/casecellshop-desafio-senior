// Define envs ANTES de qualquer import dos módulos da aplicação.
// Tracing fica off para não poluir o output dos testes; log level alto pelo
// mesmo motivo.
process.env.NODE_ENV = 'test';
process.env.OTEL_ENABLED = 'false';
process.env.LOG_LEVEL = 'fatal';
// Reduz latência simulada do ERP para acelerar testes.
process.env.ERP_FAILURE_RATE = process.env.ERP_FAILURE_RATE ?? '0';
process.env.ERP_LATENCY_MS_MIN = process.env.ERP_LATENCY_MS_MIN ?? '10';
process.env.ERP_LATENCY_MS_MAX = process.env.ERP_LATENCY_MS_MAX ?? '50';
process.env.PRODUCTS_CACHE_TTL_SECONDS = process.env.PRODUCTS_CACHE_TTL_SECONDS ?? '2';
