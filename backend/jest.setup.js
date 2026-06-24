// jest.setup.js
require('dotenv').config({ path: '.env.test' });

// Set test timeouts
jest.setTimeout(60000);

// Mock ESM-only packages that Jest cannot transform
jest.mock('uuid', () => ({
  v4: () => '00000000-0000-0000-0000-000000000000',
  v7: () => '00000000-0000-0000-0000-000000000000',
}));

// Mock OpenTelemetry to prevent async SDK init leaks after tests
// Keep actual API exports so downstream packages (gcp, aws) can use them
jest.mock('@opentelemetry/sdk-node', () => {
  try { const a = jest.requireActual('@opentelemetry/sdk-node'); return { ...a, NodeSDK: jest.fn() }; }
  catch { return { NodeSDK: jest.fn() }; }
});
jest.mock('@opentelemetry/exporter-otlp-grpc', () => {
  try { const a = jest.requireActual('@opentelemetry/exporter-otlp-grpc'); return { ...a, OTLPTraceExporter: jest.fn() }; }
  catch { return { OTLPTraceExporter: jest.fn() }; }
});
jest.mock('@opentelemetry/exporter-jaeger', () => {
  try { const a = jest.requireActual('@opentelemetry/exporter-jaeger'); return { ...a, JaegerExporter: jest.fn() }; }
  catch { return { JaegerExporter: jest.fn() }; }
});
jest.mock('@opentelemetry/resources', () => {
  try { const a = jest.requireActual('@opentelemetry/resources'); return { ...a, Resource: jest.fn() }; }
  catch { return { Resource: jest.fn() }; }
});
jest.mock('@opentelemetry/semantic-conventions', () => {
  try { return jest.requireActual('@opentelemetry/semantic-conventions'); }
  catch { return {}; }
});
jest.mock('@opentelemetry/api', () => {
  try {
    const a = jest.requireActual('@opentelemetry/api');
    return { ...a, trace: { ...a.trace, getTracer: jest.fn() } };
  } catch {
    return { trace: { getTracer: jest.fn() }, SpanStatusCode: {}, SpanKind: {} };
  }
});
jest.mock('@opentelemetry/auto-instrumentations-node', () => {
  try { const a = jest.requireActual('@opentelemetry/auto-instrumentations-node'); return { ...a, getNodeAutoInstrumentations: jest.fn() }; }
  catch { return { getNodeAutoInstrumentations: jest.fn() }; }
});

// Mock firebase-admin globally to avoid requiring service account file
jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  credential: { cert: jest.fn() },
  messaging: jest.fn(() => ({
    sendEachForMulticast: jest.fn().mockResolvedValue({ successCount: 0, failureCount: 0 }),
  })),
}));

// Setup OpenAPI validation for tests
try {
  const jestOpenAPI = require('jest-openapi').default;
  const swaggerSpec = require('./src/swagger/options');
  jestOpenAPI(swaggerSpec);
} catch (error) {
  console.warn('OpenAPI validation setup failed (optional):', error.message);
}
