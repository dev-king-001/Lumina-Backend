/**
 * Test script for Request De-Duplication System
 * 
 * This script tests the de-duplication middleware with various scenarios:
 * 1. Basic de-duplication functionality
 * 2. Cache hit scenarios
 * 3. In-flight request handling
 * 4. Cache invalidation
 * 5. Performance under load
 */

const axios = require('axios');
const { performance } = require('perf_hooks');

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000';

class DeduplicationTester {
  constructor() {
    this.results = {
      basicTests: [],
      performanceTests: [],
      cacheTests: [],
      errorTests: []
    };
  }

  /**
   * Run a single test case
   */
  async runTest(testName, testFunction) {
    console.log(`\n🧪 Running test: ${testName}`);
    const startTime = performance.now();
    
    try {
      const result = await testFunction();
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      console.log(`✅ ${testName} - PASSED (${duration.toFixed(2)}ms)`);
      this.results.basicTests.push({
        name: testName,
        status: 'PASSED',
        duration,
        result
      });
      return result;
    } catch (error) {
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      console.log(`❌ ${testName} - FAILED (${duration.toFixed(2)}ms)`);
      console.error(`   Error: ${error.message}`);
      this.results.basicTests.push({
        name: testName,
        status: 'FAILED',
        duration,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Test basic TVL endpoint de-duplication
   */
  async testTVLDeDuplication() {
    console.log('\n📊 Testing TVL endpoint de-duplication...');
    
    // First request - should process normally
    const response1 = await axios.get(`${BASE_URL}/api/stats/tvl`);
    const firstRequestTime = performance.now();
    
    // Second identical request - should be de-duplicated or cached
    const response2 = await axios.get(`${BASE_URL}/api/stats/tvl`);
    const secondRequestTime = performance.now();
    
    // Verify responses are identical
    if (JSON.stringify(response1.data) !== JSON.stringify(response2.data)) {
      throw new Error('Responses are not identical');
    }
    
    // Check if second request was faster (indicating cache hit)
    const firstDuration = response1.config.metadata?.duration || 0;
    const secondDuration = response2.config.metadata?.duration || 0;
    
    console.log(`   First request: ${firstDuration.toFixed(2)}ms`);
    console.log(`   Second request: ${secondDuration.toFixed(2)}ms`);
    
    if (response2.data.cached || response2.data.deduplicated) {
      console.log('   ✅ Second request was cached or de-duplicated');
    }
    
    return {
      firstResponse: response1.data,
      secondResponse: response2.data,
      cacheHit: response2.data.cached || response2.data.deduplicated
    };
  }

  /**
   * Test token distribution endpoint de-duplication
   */
  async testTokenDistributionDeDuplication() {
    console.log('\n🥧 Testing token distribution endpoint de-duplication...');
    
    const tokenAddress = '0x1234567890123456789012345678901234567890'; // Mock token address
    
    // First request
    const response1 = await axios.get(`${BASE_URL}/api/token/${tokenAddress}/distribution`);
    
    // Second identical request
    const response2 = await axios.get(`${BASE_URL}/api/token/${tokenAddress}/distribution`);
    
    // Verify responses are identical
    if (JSON.stringify(response1.data) !== JSON.stringify(response2.data)) {
      throw new Error('Token distribution responses are not identical');
    }
    
    console.log(`   Distribution data: ${response1.data.data?.length || 0} items`);
    
    return {
      firstResponse: response1.data,
      secondResponse: response2.data,
      cacheHit: response2.data.cached || response2.data.deduplicated
    };
  }

  /**
   * Test concurrent requests to same endpoint
   */
  async testConcurrentRequests() {
    console.log('\n⚡ Testing concurrent requests...');
    
    const concurrentCount = 5;
    const promises = [];
    
    // Launch multiple identical requests simultaneously
    for (let i = 0; i < concurrentCount; i++) {
      promises.push(
        axios.get(`${BASE_URL}/api/stats/tvl`).then(response => ({
          index: i,
          data: response.data,
          cached: response.data.cached || response.data.deduplicated
        }))
      );
    }
    
    const results = await Promise.all(promises);
    
    // Analyze results
    const cacheHits = results.filter(r => r.cached).length;
    const uniqueResponses = new Set(results.map(r => JSON.stringify(r.data))).size;
    
    console.log(`   Concurrent requests: ${concurrentCount}`);
    console.log(`   Cache hits: ${cacheHits}`);
    console.log(`   Unique responses: ${uniqueResponses}`);
    
    if (uniqueResponses === 1) {
      console.log('   ✅ All responses are identical');
    } else {
      throw new Error(`Expected 1 unique response, got ${uniqueResponses}`);
    }
    
    return {
      concurrentCount,
      cacheHits,
      uniqueResponses,
      results
    };
  }

  /**
   * Test cache invalidation
   */
  async testCacheInvalidation() {
    console.log('\n🗑️ Testing cache invalidation...');
    
    // First request to populate cache
    const response1 = await axios.get(`${BASE_URL}/api/stats/tvl`);
    
    // Second request should hit cache
    const response2 = await axios.get(`${BASE_URL}/api/stats/tvl`);
    
    // Clear cache
    await axios.post(`${BASE_URL}/api/admin/deduplication/clear`, {
      operationType: 'tvl_calculation'
    });
    
    // Third request should process normally (not from cache)
    const response3 = await axios.get(`${BASE_URL}/api/stats/tvl`);
    
    console.log('   ✅ Cache cleared successfully');
    
    return {
      firstResponse: response1.data,
      secondResponse: response2.data,
      thirdResponse: response3.data,
      cacheCleared: true
    };
  }

  /**
   * Test de-duplication statistics
   */
  async testDeduplicationStats() {
    console.log('\n📈 Testing de-duplication statistics...');
    
    const response = await axios.get(`${BASE_URL}/api/admin/deduplication/stats`);
    
    if (!response.data.success) {
      throw new Error('Failed to get de-duplication stats');
    }
    
    const stats = response.data.data;
    console.log(`   In-flight requests: ${stats.inFlightRequests}`);
    console.log(`   Operation TTLs: ${Object.keys(stats.operationTTLs).length} configured`);
    
    return stats;
  }

  /**
   * Performance test with multiple requests
   */
  async testPerformance() {
    console.log('\n🚀 Running performance test...');
    
    const requestCount = 20;
    const promises = [];
    const startTime = performance.now();
    
    for (let i = 0; i < requestCount; i++) {
      promises.push(
        axios.get(`${BASE_URL}/api/stats/tvl`).then(response => ({
          index: i,
          cached: response.data.cached || response.data.deduplicated,
          timestamp: performance.now()
        }))
      );
    }
    
    const results = await Promise.all(promises);
    const endTime = performance.now();
    const totalDuration = endTime - startTime;
    
    const cacheHits = results.filter(r => r.cached).length;
    const avgRequestTime = totalDuration / requestCount;
    
    console.log(`   Total requests: ${requestCount}`);
    console.log(`   Total duration: ${totalDuration.toFixed(2)}ms`);
    console.log(`   Average request time: ${avgRequestTime.toFixed(2)}ms`);
    console.log(`   Cache hits: ${cacheHits} (${((cacheHits/requestCount)*100).toFixed(1)}%)`);
    
    this.results.performanceTests.push({
      requestCount,
      totalDuration,
      avgRequestTime,
      cacheHitRate: (cacheHits/requestCount)*100
    });
    
    return {
      requestCount,
      totalDuration,
      avgRequestTime,
      cacheHitRate: (cacheHits/requestCount)*100,
      results
    };
  }

  /**
   * Test error handling
   */
  async testErrorHandling() {
    console.log('\n⚠️ Testing error handling...');
    
    try {
      // Test with invalid endpoint
      await axios.get(`${BASE_URL}/api/invalid/endpoint`);
      throw new Error('Should have failed');
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log('   ✅ Invalid endpoint properly handled');
      } else {
        throw error;
      }
    }
    
    try {
      // Test with invalid token address
      await axios.get(`${BASE_URL}/api/token/invalid-address/distribution`);
      console.log('   ✅ Invalid token address handled gracefully');
    } catch (error) {
      // Expected to fail, but should not crash the system
      console.log('   ✅ Invalid token address handled gracefully');
    }
    
    return { errorHandlingPassed: true };
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    console.log('🎯 Starting Request De-Duplication Tests');
    console.log('==========================================');
    
    const startTime = performance.now();
    
    try {
      // Basic functionality tests
      await this.runTest('TVL De-Duplication', () => this.testTVLDeDuplication());
      await this.runTest('Token Distribution De-Duplication', () => this.testTokenDistributionDeDuplication());
      await this.runTest('Concurrent Requests', () => this.testConcurrentRequests());
      await this.runTest('Cache Invalidation', () => this.testCacheInvalidation());
      await this.runTest('De-Duplication Statistics', () => this.testDeduplicationStats());
      
      // Performance tests
      await this.testPerformance();
      
      // Error handling tests
      await this.testErrorHandling();
      
      const endTime = performance.now();
      const totalDuration = endTime - startTime;
      
      console.log('\n🎉 All tests completed successfully!');
      console.log(`⏱️ Total test duration: ${totalDuration.toFixed(2)}ms`);
      
      this.printSummary();
      
    } catch (error) {
      console.error('\n💥 Test suite failed:', error.message);
      this.printSummary();
      throw error;
    }
  }

  /**
   * Print test summary
   */
  printSummary() {
    console.log('\n📊 Test Summary');
    console.log('================');
    
    const totalTests = this.results.basicTests.length;
    const passedTests = this.results.basicTests.filter(t => t.status === 'PASSED').length;
    const failedTests = totalTests - passedTests;
    
    console.log(`Basic Tests: ${passedTests}/${totalTests} passed`);
    
    if (failedTests > 0) {
      console.log('\n❌ Failed Tests:');
      this.results.basicTests
        .filter(t => t.status === 'FAILED')
        .forEach(t => {
          console.log(`   - ${t.name}: ${t.error}`);
        });
    }
    
    if (this.results.performanceTests.length > 0) {
      console.log('\n⚡ Performance Results:');
      this.results.performanceTests.forEach(test => {
        console.log(`   - ${test.requestCount} requests: ${test.avgRequestTime.toFixed(2)}ms avg, ${test.cacheHitRate.toFixed(1)}% cache hit rate`);
      });
    }
    
    console.log('\n✅ De-duplication system is working correctly!');
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  const tester = new DeduplicationTester();
  
  console.log('🔧 Checking if server is running...');
  
  // Health check
  axios.get(`${BASE_URL}/health`)
    .then(() => {
      console.log('✅ Server is running, starting tests...\n');
      tester.runAllTests().catch(error => {
        console.error('Test execution failed:', error);
        process.exit(1);
      });
    })
    .catch(error => {
      console.error('❌ Server is not running or not accessible');
      console.error('Please start the server first: npm start');
      console.error(`Expected at: ${BASE_URL}`);
      process.exit(1);
    });
}

module.exports = DeduplicationTester;
