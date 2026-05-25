# CaseCellShop — Desafio Técnico Senior Backend

Mini-serviço backend que demonstra **cache**, **observabilidade**, **concorrência/idempotência** e **resiliência assíncrona** num cenário de e-commerce com ERP legado lento.

> Empresa fictícia. Caso usado exclusivamente para fins de avaliação técnica.

## Sumário

- [Visão geral](#visão-geral)
- [Stack](#stack)
- [Como rodar](#como-rodar)
- [Endpoints](#endpoints)
- [Decisões e trade-offs](#decisões-e-trade-offs)
- [Observabilidade](#observabilidade)
- [Testes](#testes)
- [Limitações conhecidas](#limitações-conhecidas)
- [Estrutura do repositório](#estrutura-do-repositório)

## Visão geral

A loja virtual da CaseCellShop consulta diretamente o ERP (MySQL, read-only) a cada acesso. Com o crescimento, surgiram três problemas:

1. **Vitrine lenta** — cada request bate no ERP.
2. **Overselling** — `SELECT then UPDATE` permite que dois clientes comprem o mesmo último item.
3. **Checkout instável** — ERP demora para faturar; perdemos pedidos em timeout.

Este serviço endereça os três:

- `GET /products` com cache-aside + single-flight (anti-stampede).
- `POST /checkout` com `Idempotency-Key` + reserva atômica de estoque + resposta `202 Accepted`.
- Worker assíncrono (BullMQ) simulando envio ao ERP com retry e DLQ.
- `GET /orders/:id/status` para acompanhamento.

## Stack

- **Node.js 22 + TypeScript**
- **Fastify** — HTTP server (mais leve que Express).
- **Redis** — cache + broker da fila.
- **Postgres** — banco próprio da loja (catálogo replicado + pedidos + idempotência).
- **BullMQ** — fila de jobs com retry e DLQ.
- **Pino** — logs estruturados JSON.
- **prom-client** — métricas Prometheus.
- **OpenTelemetry** — traces (console exporter no ambiente local).
- **Vitest** — testes unitários e de concorrência.
- **Zod** — validação de payloads.

## Como rodar

Pré-requisitos: Node.js ≥ 20, pnpm, Docker Desktop.

```bash
# 1. instalar dependências
pnpm install

# 2. subir Redis + Postgres
docker compose up -d

# 3. rodar migrações e seed (catálogo de capinhas)
pnpm migrate
pnpm seed

# 4. iniciar API e worker (em terminais separados)
pnpm dev          # API em :3000
pnpm worker       # worker da fila

# 5. testes
pnpm test
```

A documentação OpenAPI fica disponível em `http://localhost:3000/docs` (Swagger UI) e o endpoint Prometheus em `http://localhost:3000/metrics`.

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/products` | Lista catálogo (cache TTL 30s). |
| POST | `/checkout` | Inicia compra assíncrona. Header `Idempotency-Key` obrigatório. Retorna `202 Accepted`. |
| GET | `/orders/:orderId/status` | Status do pedido (`pending`, `confirmed`, `failed`). |
| GET | `/health` | Health check. |
| GET | `/metrics` | Métricas Prometheus. |

Contrato completo em [`openapi.yaml`](./openapi.yaml).

## Decisões e trade-offs

> Documentadas aqui em forma resumida; raciocínio detalhado em [`docs/RESPOSTAS.md`](./docs/RESPOSTAS.md).

- **Cache-aside com TTL curto (30s)** em vez de refresh-ahead — simples e suficiente para vitrine; o trade-off é janela de inconsistência limitada (até 30s).
- **Single-flight via Redis lock** para prevenir cache stampede em chave quente.
- **Reserva atômica de estoque** com `UPDATE ... WHERE stock >= qty` (atomic conditional) — evita race condition sem custo de lock pessimista.
- **Outbox pattern simplificado** — gravamos pedido + job na mesma transação local; worker consome e simula chamada ao ERP.
- **Idempotência por chave** — tabela `idempotency_keys (key, response, expires_at)`. Primeira chamada processa; duplicatas retornam a resposta original.
- **Retry com backoff exponencial + DLQ** no BullMQ — jobs que falham 5x vão para `checkout-dlq` para reconciliação manual.

## Observabilidade

### Logs
Pino com formato JSON. Campos obrigatórios: `correlationId`, `service`, `route`, `method`, `statusCode`, `latencyMs`, `outcome`. Quando aplicável: `orderId`, `sku`, `cacheStatus`.

### Métricas (Prometheus)
- `http_request_duration_seconds` (histogram, por rota + status).
- `cache_hits_total` / `cache_misses_total` (counter, por chave).
- `cache_value_age_seconds` (gauge — observa freshness).
- `checkout_started_total` / `checkout_completed_total` / `checkout_failed_total`.
- `queue_jobs_active` / `queue_jobs_waiting` / `queue_jobs_failed` (gauge).
- `dlq_size` (gauge).

### Traces
Span tree do `POST /checkout`: `http.request` → `idempotency.check` → `db.reserve_stock` → `db.insert_order` → `queue.enqueue` → (assíncrono) `worker.process` → `erp.invoice` → `db.update_order`.

### Dashboard (exemplo conceitual — Datadog-like)
- Row 1: latência p50/p95/p99 por rota.
- Row 2: cache hit ratio + valor médio de `cache_value_age_seconds`.
- Row 3: checkout funnel (started → completed → failed) + DLQ size.
- Row 4: fila — jobs waiting/active/failed.

### Alertas
- `cache_hit_ratio < 0.7` por 5min → warning.
- `dlq_size > 0` → page (oncall).
- `p95 GET /products > 500ms` por 10min → warning.
- `checkout_failed_total / checkout_started_total > 0.02` (rolling 15min) → page.

### Runbook (resumo)
- **DLQ growing**: ver `docs/runbooks/dlq.md` — passos para inspecionar payload, reprocessar e reconciliar com ERP.
- **Cache hit baixo**: checar TTL, eventos de invalidação em massa, falhas no Redis.

## Testes

- Regra de negócio: não vender sem estoque.
- Cache: hit/miss/expiração.
- **Concorrência** — 10 requests paralelos disputando o último item. Apenas 1 deve receber `202`; os outros devem receber `409 Conflict`.
- Idempotência — mesma `Idempotency-Key` em 2 chamadas → mesma resposta, estoque não decrementa duas vezes.

```bash
pnpm test           # roda tudo
pnpm test:watch
```

## Limitações conhecidas

- Sem autenticação, sem pagamento real, sem deploy, sem front-end — escopo do desafio.
- ERP é simulado por um módulo `fake-erp/` com latência e falha aleatórias.
- Reconciliação periódica com ERP existe como stub (worker `reconcile`), mas não está agendada.
- Traces saem no console (sem exporter remoto) — em produção apontar para Datadog/Jaeger/Tempo.

## Estrutura do repositório

```
case-cellshop/
├── README.md
├── PROMPTS.md          # prompts de IA usados (uso responsável)
├── openapi.yaml        # contrato
├── docker-compose.yml  # Redis + Postgres
├── docs/
│   ├── RESPOSTAS.md    # respostas das 5 perguntas conceituais
│   └── runbooks/
└── api/
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── server.ts
        ├── routes/
        ├── services/
        ├── repositories/
        ├── workers/
        ├── observability/
        └── tests/
```
