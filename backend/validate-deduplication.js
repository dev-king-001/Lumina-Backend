/**
 * Simple validation script for Request De-Duplication System
 * This script validates that the implementation is correctly integrated
 */

const requestDeduplicationMiddleware = require('./src/middleware/requestDeduplication.middleware');

async function validateImplementation() {
  console.log('🔍 Validating Request De-Duplication Implementation');
  console.log('==================================================');

  try {
    // Test 1: Middleware exists and is properly configured
    console.log('\n1. Testing middleware instantiation...');
    if (requestDeduplicationMiddleware && typeof requestDeduplicationMiddleware.middleware === 'function') {
      console.log('✅ Middleware is properly instantiated');
    } else {
      throw new Error('Middleware is not properly instantiated');
    }

    // Test 2: Request fingerprinting
    console.log('\n2. Testing request fingerprinting...');
    const mockReq = {
      method: 'GET',
      originalUrl: '/api/stats/tvl',
      query: {},
      body: {},
      user: { address: '0x1234567890123456789012345678901234567890' }
    };

    const fingerprint = requestDeduplicationMiddleware.generateRequestFingerprint(mockReq);
    if (fingerprint && typeof fingerprint === 'string' && fingerprint.length === 64) {
      console.log('✅ Request fingerprinting works correctly');
      console.log(`   Sample fingerprint: ${fingerprint.substring(0, 16)}...`);
    } else {
      throw new Error('Request fingerprinting failed');
    }

    // Test 3: Operation type detection
    console.log('\n3. Testing operation type detection...');
    const testCases = [
      { url: '/api/stats/tvl', expected: 'tvl_calculation' },
      { url: '/api/org/123/export/xero', expected: 'accounting_export' },
      { url: '/api/vaults/456/export', expected: 'vault_export' },
      { url: '/api/claims/user/realized-gains', expected: 'realized_gains' },
      { url: '/api/token/abc/distribution', expected: 'token_distribution' },
      { url: '/api/unknown/endpoint', expected: 'default' }
    ];

    for (const testCase of testCases) {
      const mockReq = { originalUrl: testCase.url };
      const operationType = requestDeduplicationMiddleware.getOperationType(mockReq);
      if (operationType === testCase.expected) {
        console.log(`   ✅ ${testCase.url} → ${operationType}`);
      } else {
        throw new Error(`Expected ${testCase.expected}, got ${operationType}`);
      }
    }

    // Test 4: TTL configuration
    console.log('\n4. Testing TTL configuration...');
    const stats = requestDeduplicationMiddleware.getStats();
    if (stats.operationTTLs && typeof stats.operationTTLs === 'object') {
      console.log('✅ TTL configuration is available');
      console.log('   Configured TTLs:');
      Object.entries(stats.operationTTLs).forEach(([op, ttl]) => {
        console.log(`     - ${op}: ${ttl}s`);
      });
    } else {
      throw new Error('TTL configuration is missing');
    }

    // Test 5: Cache key generation
    console.log('\n5. Testing cache key generation...');
    const cacheKey = requestDeduplicationMiddleware.getCacheKey(fingerprint, 'tvl_calculation');
    if (cacheKey && cacheKey.startsWith('dedup:tvl_calculation:')) {
      console.log('✅ Cache key generation works correctly');
      console.log(`   Sample cache key: ${cacheKey}`);
    } else {
      throw new Error('Cache key generation failed');
    }

    // Test 6: Middleware configuration
    console.log('\n6. Testing middleware configuration...');
    const middleware = requestDeduplicationMiddleware.middleware({
      enabled: true,
      skipPaths: ['/auth', '/admin/revoke'],
      skipMethods: ['POST', 'PUT', 'DELETE']
    });

    if (typeof middleware === 'function') {
      console.log('✅ Middleware configuration works correctly');
    } else {
      throw new Error('Middleware configuration failed');
    }

    console.log('\n🎉 All validation tests passed!');
    console.log('✅ Request De-Duplication implementation is correctly integrated');
    
    console.log('\n📋 Next Steps:');
    console.log('1. Start the server: npm start');
    console.log('2. Run comprehensive tests: node test-deduplication.js');
    console.log('3. Monitor de-duplication: GET /api/admin/deduplication/stats');
    
    return true;

  } catch (error) {
    console.error('\n❌ Validation failed:', error.message);
    console.error('Please check the implementation and try again.');
    return false;
  }
}

// Run validation if this script is executed directly
if (require.main === module) {
  validateImplementation().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = validateImplementation;
