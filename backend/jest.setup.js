// jest.setup.js
require('dotenv').config({ path: '.env.test' });

// Set test timeouts
jest.setTimeout(60000);

// Mock ESM-only packages that Jest cannot transform
jest.mock('uuid', () => ({
  v4: () => '00000000-0000-0000-0000-000000000000',
  v7: () => '00000000-0000-0000-0000-000000000000',
}));

// Setup OpenAPI validation for tests
try {
  const jestOpenAPI = require('jest-openapi').default;
  const swaggerSpec = require('./src/swagger/options');
  jestOpenAPI(swaggerSpec);
} catch (error) {
  console.warn('OpenAPI validation setup failed (optional):', error.message);
}
