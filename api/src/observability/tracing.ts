import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { trace } from '@opentelemetry/api';
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
