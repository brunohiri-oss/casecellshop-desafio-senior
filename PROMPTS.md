# PROMPTS.md — Uso de IA neste desafio

Este arquivo registra os prompts mais relevantes usados com IA durante a construção da solução, atendendo ao critério de **uso crítico e responsável de IA** do enunciado.

## Princípios aplicados

1. **IA como acelerador, não como autor.** Cada output da IA foi revisado contra (a) as restrições do case (ERP read-only, datacenter próprio, Datadog conceitual), (b) trade-offs explícitos, (c) capacidade de defender a decisão em entrevista.
2. **Promptar com contexto, não com instruções soltas.** Prompts incluem stack, restrições e modos de falha esperados, não apenas o "o que".
3. **Registrar quando a IA foi descartada/contestada.** Se a IA propôs algo (ex.: Redlock) que não se justifica no contexto, registro a contestação aqui.
4. **Não copiar sem entender.** Padrões que eu não conseguiria explicar foram estudados antes de adotar.

## Ferramenta usada

Claude Code (CLI) como copiloto. Conversas conduzidas em português, em **modo "fase a fase com checkpoints"** — ou seja, a cada fase do projeto eu reviso o output e aprovo antes de seguir.

---

## Sessão 1 — Análise do desafio e plano de execução

**Prompt inicial:**
> "Analise o conteúdo deste arquivo [PDF do desafio] e traga-me o passo a passo para executarmos ele, antes de executar."

**Por que esse prompt:** quis um **plano explícito antes de qualquer implementação**, evitando o anti-padrão de "IA começa a codar antes de entender o problema". Pedi confirmação de stack, infra local e modo de trabalho antes de qualquer arquivo ser criado.

**Resultado:** plano em 4 fases (preparação, conceitual, implementação, entrega), com decisões pendentes apresentadas como perguntas (stack, infra, prazo, modo).

## Sessão 2 — Decisões de stack e infra

**Contexto:** confirmar a stack preferencial e a infra mínima local. Optei por:
- Node.js + TypeScript + **Fastify** (mais leve que Express; melhor histograma de latência).
- Docker Compose com **Redis + Postgres** (mais próximo de produção do que tudo em memória).
- BullMQ para fila (sobre Redis), ioredis para cache, prom-client para métricas, OpenTelemetry com console exporter (sem conta Datadog).

**Por que documentar isso aqui:** essas decisões impactam diretamente os trade-offs discutidos nas respostas conceituais (P2 cache, P5 outbox), e foi importante que a IA não tentasse "vender" alternativas mais sofisticadas que não cabiam no escopo de "desafio sênior pequeno e executável".

## Sessão 3 — Redação das respostas conceituais

**Direcionamento dado à IA:**
- Causa raiz acima de sintoma (cada problema tem uma seção dedicada).
- Comparativos em tabela (cost / complexity / latency / consistency / ops effort).
- Diagramas Mermaid para arquitetura e fluxos.
- Sempre apontar para o código da Parte 1.B quando aplicável (referência cruzada).
- Não introduzir padrões "modernos por moda" (ex.: saga, event sourcing) quando o problema não exige.

**O que foi descartado conscientemente:**
- **Distributed lock (Redlock)** como solução de estoque — adicionado nas respostas como *contra-exemplo* explicando por que **não** usamos, citando o argumento do Martin Kleppmann sobre fencing tokens.
- **Saga distribuída** no checkout — descartada com justificativa ("temos um único ERP, não múltiplos serviços competindo por uma transação").
- **Write-through cache** — citado nas opções mas marcado como "não aplicável aqui (escrita vem do CDC do ERP)".

---

## Sessões futuras (a preencher conforme implementação avança)

- Implementação do single-flight lock para cache stampede.
- Modelagem do schema de `idempotency_keys` e `outbox_events`.
- Testes de concorrência (50 requests para 1 unidade de estoque).
- Configuração de retry e backoff no BullMQ.
- Spans de OpenTelemetry no fluxo síncrono + assíncrono.

---

## Anti-padrões evitados ao usar IA

- ❌ "Implementa o checkout pra mim" — prompt vazio sem restrições.
- ❌ Aceitar a primeira sugestão sem pedir 2-3 alternativas.
- ❌ Pedir código antes de validar a modelagem do domínio.
- ❌ Deixar a IA escolher dependências sem revisar (cada dep deve resolver um problema real do escopo).
- ❌ Copiar runbooks/dashboards "de exemplo" sem adaptar aos SLOs e modos de falha *deste* sistema.
