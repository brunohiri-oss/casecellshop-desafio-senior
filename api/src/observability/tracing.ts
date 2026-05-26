import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import {
  trace,
  context,
  propagation,
  SpanStatusCode,
  type Span,
  type Context,
} from '@opentelemetry/api';
import { env } from '../config/env.js';

let sdk: NodeSDK | null = null;

export function startTracing(): void {
  if (!env.OTEL_ENABLED) return;
  if (sdk) return;

  sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: env.SERVICE_NAME,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: env.NODE_ENV,
    }),
    spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
    instrumentations: [
      new HttpInstrumentation(),
      new FastifyInstrumentation(),
      new PgInstrumentation(),
      new IORedisInstrumentation(),
    ],
  });

  sdk.start();
}

export async function stopTracing(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = null;
}

export const tracer = trace.getTracer('casecellshop-api');

/**
 * Wrapper para spans manuais que cuida de:
 *  - registrar erro no span (recordException + status ERROR) e rethrow;
 *  - sempre fechar o span (try/finally).
 */
export async function withSpan<T>(
  name: string,
  attrs: Record<string, string | number | boolean | undefined>,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    setAttrs(span, attrs);
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}

export function setAttrs(span: Span, attrs: Record<string, string | number | boolean | undefined>): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined) span.setAttribute(k, v);
  }
}

/**
 * Captura o contexto OTel atual num objeto serializável (W3C Trace Context),
 * para anexar ao payload do job e propagar até o worker.
 */
export function injectContext(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}

/** Extrai contexto OTel de um carrier (job data) para usar como pai do span do worker. */
export function extractContext(carrier: Record<string, string> | undefined): Context {
  if (!carrier) return context.active();
  return propagation.extract(context.active(), carrier);
}

export { context, SpanStatusCode };

