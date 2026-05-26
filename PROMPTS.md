# PROMPTS.md — Uso de IA neste desafio

Registro dos prompts mais relevantes usados com IA durante a construção da solução, atendendo ao critério de **uso crítico e responsável de IA** do enunciado.

## Princípios aplicados

1. **IA como acelerador, não como autor.** Cada output revisado contra (a) as restrições do case (ERP read-only, datacenter próprio, Datadog conceitual), (b) trade-offs explícitos, (c) capacidade de defender cada decisão em entrevista.
2. **Promptar com contexto, não com instruções soltas.** Prompts incluem stack, restrições, modos de falha esperados — não apenas o "o que".
3. **Registrar quando a IA foi descartada/contestada.** Padrões propostos que não cabem no contexto (ex.: Redlock) ficam documentados como decisão consciente.
4. **Os testes são o juiz final.** A IA sugere; os testes provam. Bugs encontrados pelos testes ficam aqui registrados.

## Ferramenta

Claude Code (CLI) como copiloto. Conversas em português, em **modo "fase a fase com checkpoints"** — a cada fase eu reviso o output e aprovo antes de seguir.

---

## Sessão 1 — Análise do desafio e plano de execução

**Prompt inicial:**
> "Analise o conteúdo deste arquivo [PDF do desafio] e traga-me o passo a passo para executarmos ele, antes de executar."

**Por que esse prompt:** quis um **plano explícito antes de qualquer implementação**. Como senior, contratar o ritmo (4 fases) e as decisões iniciais (stack, infra, prazo, modo de trabalho) antes de o primeiro arquivo ser criado evita refatorações grandes depois.

**Resultado:** plano com 4 fases + perguntas direcionadas (stack/infra/prazo/modo) apresentadas como `AskUserQuestion` em vez de a IA chutar.

## Sessão 2 — Stack e infra

Decisões tomadas após ponderar:
- **Node.js + TypeScript + Fastify** (vs Express): Fastify ganha em throughput e tem schemas first-class — relevante para um desafio que pede métricas de latência.
- **Docker Compose com Redis + Postgres reais** (vs tudo em memória): mais próximo de produção, demonstra que conheço o pipeline real. Os testes rodam contra o mesmo stack via `pnpm test`.
- **BullMQ + Redis** para fila (vs RabbitMQ/SQS): zero overhead de infra adicional, mesmo Redis do cache, ainda oferece DLQ + retry + persistência.

**O que descartei (e documento por quê):**
- Não usei NestJS — boilerplate excessivo para um serviço pequeno; o avaliador vê melhor o raciocínio em código direto.
- Não usei ORM completo (Prisma/Sequelize) — `pg` cru deixa as queries críticas (atomic UPDATE no estoque) visíveis e auditáveis.

## Sessão 3 — Redação das respostas conceituais (Parte 1.A)

**Direcionamento:**
- Causa raiz acima de sintoma — cada problema do enunciado tem seção dedicada.
- Comparativos em tabela (cost/complexity/latency/consistency/ops).
- Diagramas Mermaid para arquitetura alvo e fluxos.
- Apontar para o código da Parte 1.B onde aplicável.
- Não introduzir padrões "modernos por moda" se não resolverem o problema.

**Descartados conscientemente nas respostas:**
- **Distributed lock (Redlock)** — documentado como contra-exemplo na P4, citando o argumento do Kleppmann sobre fencing tokens. Não cabe quando temos banco transacional.
- **Saga distribuída** — descartada na P3 com justificativa ("temos um único ERP, não múltiplos serviços competindo por transação").
- **Write-through cache** — citado nas opções da P2 mas marcado como não aplicável (escrita vem do CDC do ERP).

## Sessão 4 — Estratégia do cache stampede

**Pergunta para a IA:**
> "Vou implementar single-flight em Redis para o cache de /products. Quero ver 3 abordagens e o trade-off de cada uma."

A IA propôs: (a) lock simples com `SET NX`, (b) lock com token + Lua release, (c) refresh-ahead com worker dedicado. Escolhi **(b)** porque é a mais barata em complexidade e oferece a garantia que importa: nunca liberar lock alheio se a operação demorou.

**Implementação coberta por teste**: `cache.test.ts` afirma que com **20 requests concorrentes num miss, o loader é chamado exatamente 1 vez**. Sem isso, não há prova de que a solução funciona.

## Sessão 5 — Modelagem de idempotência

**Discussão:** o que acontece se a mesma `Idempotency-Key` chegar com payload diferente?

- Opção naive: ignorar e retornar a resposta original → silencia bugs do cliente.
- Opção rigorosa: **`request_hash` (SHA256 do body normalizado) na tabela, mismatch retorna 422** → cliente sabe que tem bug.

Optei pela rigorosa. Detalhe adicionado: hash sobre items ordenados por SKU para que `[A,B]` e `[B,A]` sejam tratados como mesma intenção. Coberto pelo teste `hash insensitive à ordem dos items`.

## Sessão 6 — Bug encontrado pelos testes (refatoração de rollback)

**Contexto:** ao escrever `concurrency.test.ts`, adicionei um teste para pedidos multi-item: "se um SKU tem estoque e outro não, nem o primeiro decremento deve persistir (atomicidade)".

O teste falhou:
```
× multi-item: rollback restaura decrementos parciais se um SKU falhar
  AssertionError: expected 9 to be 10
```

**Diagnóstico:** olhando o código original do `processCheckout`:

```ts
const txResult = await withTx(async (client) => {
  const reserve = await reserveStockTx(client, items);
  if (!reserve.ok) {
    // ... gravar idempotência 409 ...
    return { kind: 'rejected', ... };   // ← RETURN, não THROW
  }
  // ... fluxo feliz ...
});
```

E o `withTx`:
```ts
async function withTx<T>(fn) {
  await client.query('BEGIN');
  try {
    const result = await fn(client);
    await client.query('COMMIT');   // ← commit em qualquer return
    return result;
  } catch (err) {
    await client.query('ROLLBACK'); // ← rollback só em throw
    throw err;
  }
}
```

Em pedidos multi-item, o primeiro UPDATE de estoque era aplicado, o segundo retornava `rowCount=0`, eu retornava `{ kind: 'rejected' }`, e a tx **commitava** — deixando o decremento parcial persistido.

**Em produção sob carga, isso seria "estoque sumindo misteriosamente" em pedidos multi-item.** Em runtime single-item (como o teste de 50 paralelos), o bug não aparecia porque só havia 1 UPDATE.

**Refatoração:**
```ts
if (!reserve.ok) {
  throw new InsufficientStockError(reserve.reason, reserve.sku);  // ← força ROLLBACK
}
// (lança fora da tx, captura em outer catch, grava idempotência 409 em tx separada)
```

**Lição reforçada:** ter o teste do cenário multi-item foi o que pegou o bug. A IA não tinha como saber — o código "parecia certo". O teste é o juiz.

## Sessão 7 — Propagação de contexto OTel via BullMQ

**Pergunta para a IA:**
> "Como propago W3C Trace Context através de um job BullMQ pra que o span do worker apareça como continuação do mesmo traceId do request HTTP?"

A resposta inicial sugeriu instrumentação automática do BullMQ (`@opentelemetry/instrumentation-bullmq`). Descartei porque (a) é uma dep adicional e (b) o controle manual fica mais explícito no código.

**Implementação adotada:**
- Producer: `propagation.inject(context.active(), carrier)` → carrier vai como `job.data._otel`.
- Worker: `propagation.extract(context.active(), job.data._otel)` → usado como pai do span via `context.with(...)`.

Validado E2E observando o output do `ConsoleSpanExporter`: o `traceId=aef60137...` aparece em ambos os processos (API e worker), comprovando a continuidade do trace.

## Sessão 8 — Documentação

Foco no que o avaliador precisa para confiar na entrega:
- README com diagrama da **arquitetura implementada** (não da alvo), comandos exatos, saída de teste esperada.
- Tabela "critérios do PDF → arquivos/testes" para mostrar mapeamento direto.
- Trade-offs explícitos — o que **não** fizemos e por quê.

---

## Anti-padrões evitados ao usar IA

- ❌ "Implementa o checkout pra mim" — prompt vazio.
- ❌ Aceitar primeira sugestão sem pedir 2-3 alternativas.
- ❌ Pedir código antes de validar a modelagem do domínio.
- ❌ Deixar a IA escolher dependências sem revisar (cada dep deve resolver um problema real do escopo).
- ❌ Copiar runbooks/dashboards "de exemplo" sem adaptar aos SLOs e modos de falha *deste* sistema.
- ❌ Confiar no código sem teste que prove a invariante.

## O que a IA fez de melhor neste projeto

- Acelerou os trechos mecânicos (OpenAPI YAML, boilerplate de testes, conversões de schema).
- Sugeriu o pattern de `withSpan` wrapper que evita try/finally repetido em cada chamada manual de span.
- Lembrou de detalhes operacionais que eu poderia ter esquecido (Lua script no release de lock Redis com check de token).

## O que a IA não conseguiu fazer sozinha

- Identificar o bug do rollback multi-item. **O teste foi o catch.**
- Decidir trade-offs específicos do contexto (ex.: descartar Redlock por causa do banco transacional). Isso exigiu critério humano.
- Saber quando parar de adicionar features. "Outbox publisher real" e "reconciliador" foram **conscientemente descartados** do escopo e documentados como trade-off.
