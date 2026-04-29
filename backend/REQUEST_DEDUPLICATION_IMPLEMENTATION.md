# Request De-Duplication Implementation

## Overview

This implementation provides a comprehensive request de-duplication system for heavy cap-table aggregation operations in the Vesting Vault backend. The system prevents duplicate processing of identical requests, improves performance through intelligent caching, and ensures data consistency.

## Features

### 🎯 Core Functionality
- **Request Fingerprinting**: SHA-256 based fingerprinting of request parameters
- **In-Flight Request Tracking**: Prevents duplicate processing of concurrent requests
- **Intelligent Caching**: Redis-based result caching with configurable TTL
- **Operation-Specific TTL**: Different cache durations for different operation types
- **Cache Invalidation**: Automatic cache clearing on data updates

### 🚀 Performance Benefits
- **Reduced Database Load**: Prevents duplicate heavy aggregation queries
- **Faster Response Times**: Cached responses for identical requests
- **Better Resource Utilization**: Efficient handling of concurrent requests
- **Scalability**: Handles high traffic without performance degradation

## Implementation Details

### Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Client Request│───▶│  Deduplication   │───▶│  Service Layer  │
│                 │    │   Middleware     │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │                        │
                              ▼                        ▼
                       ┌──────────────┐        ┌──────────────┐
                       │   Redis      │        │   Database    │
                       │    Cache     │        │               │
                       └──────────────┘        └──────────────┘
```

### Key Components

#### 1. Request Deduplication Middleware (`requestDeduplication.middleware.js`)

**Purpose**: Central component that handles request de-duplication logic.

**Key Features**:
- Request fingerprinting using SHA-256
- In-flight request tracking (in-memory + Redis)
- Result caching with operation-specific TTL
- Concurrent request handling

**Configuration**:
```javascript
app.use('/api', requestDeduplicationMiddleware.middleware({
  enabled: true,
  skipPaths: ['/auth', '/admin/revoke', '/admin/create', '/admin/transfer', '/claims'],
  skipMethods: ['POST', 'PUT', 'DELETE', 'PATCH']
}));
```

#### 2. Enhanced Services

**TVL Service** (`tvlService.js`):
- Automatic cache invalidation on vault/claim events
- Integration with de-duplication system
- Performance monitoring

**Accounting Export Service** (`accountingExportService.js`):
- Cache invalidation for organization-specific exports
- Export-specific cache keys
- Integration with de-duplication middleware

#### 3. Management Endpoints

**Statistics** (`GET /api/admin/deduplication/stats`):
```json
{
  "success": true,
  "data": {
    "inFlightRequests": 2,
    "operationTTLs": {
      "tvl_calculation": 180,
      "accounting_export": 600,
      "vault_export": 600,
      "realized_gains": 300,
      "token_distribution": 180,
      "default": 60
    }
  }
}
```

**Cache Management** (`POST /api/admin/deduplication/clear`):
```json
{
  "operationType": "tvl_calculation"  // Optional - clears all if not specified
}
```

### Operation Types & TTL Configuration

| Operation Type | TTL (seconds) | Description |
|----------------|---------------|-------------|
| `tvl_calculation` | 180 | TVL aggregation across all vaults |
| `accounting_export` | 600 | Heavy accounting export queries |
| `vault_export` | 600 | Vault data export operations |
| `realized_gains` | 300 | User realized gains calculations |
| `token_distribution` | 180 | Token distribution aggregations |
| `default` | 60 | Fallback for other operations |

### Request Fingerprinting

The system generates unique fingerprints for requests based on:

- **HTTP Method**: GET, POST, etc.
- **Request Path**: Normalized URL path
- **Query Parameters**: Sorted and normalized
- **Request Body**: Excludes timestamp, nonce, signature fields
- **User Context**: User address if authenticated

**Example Fingerprint Generation**:
```javascript
const normalizedData = {
  method: 'GET',
  path: '/api/stats/tvl',
  query: {},
  body: {},
  user: '0x1234...5678'
};

const fingerprint = crypto.createHash('sha256')
  .update(JSON.stringify(normalizedData))
  .digest('hex');
```

### Cache Key Structure

```
dedup:{operationType}:{fingerprint}
```

**Examples**:
- `dedup:tvl_calculation:a1b2c3d4e5f6...`
- `dedup:accounting_export:z9y8x7w6v5u4...`

## Protected Endpoints

The following heavy aggregation endpoints are protected by de-duplication:

### 1. TVL Statistics
```
GET /api/stats/tvl
```
- Aggregates across all active vaults
- Calculates total value locked
- Updates TVL records

### 2. Token Distribution
```
GET /api/token/:address/distribution
```
- Groups vault amounts by tag
- SUM aggregation operations
- Heavy database queries

### 3. Accounting Exports
```
GET /api/org/:id/export/xero
GET /api/org/:id/export/quickbooks
GET /api/org/:id/export/summary
```
- Complex joins with ClaimsHistory
- Date range filtering
- Heavy aggregation queries

### 4. Vault Exports
```
GET /api/vaults/:id/export
```
- Complex data relationships
- Beneficiary information
- Organization details

### 5. Realized Gains
```
GET /api/claims/:userAddress/realized-gains
```
- User-specific aggregation
- Date range calculations
- Price data integration

## Cache Invalidation Strategy

### Automatic Invalidation

The system automatically invalidates relevant cache entries when:

1. **Vault Events**:
   - New vault created
   - Vault updated
   - Vault top-up events

2. **Claim Events**:
   - New claim processed
   - Claim amounts updated

3. **Data Updates**:
   - Token price changes
   - Organization data updates

### Manual Invalidation

Administrators can manually clear cache:

```bash
# Clear specific operation type
curl -X POST http://localhost:4000/api/admin/deduplication/clear \
  -H "Content-Type: application/json" \
  -d '{"operationType": "tvl_calculation"}'

# Clear all cache
curl -X POST http://localhost:4000/api/admin/deduplication/clear \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Performance Monitoring

### Metrics Tracked

1. **Cache Hit Rate**: Percentage of requests served from cache
2. **In-Flight Requests**: Number of concurrent requests being processed
3. **Response Times**: Average response time for cached vs. uncached requests
4. **Operation Performance**: Per-operation performance metrics

### Monitoring Endpoints

```bash
# Get current statistics
curl http://localhost:4000/api/admin/deduplication/stats
```

## Testing

### Test Suite

Run the comprehensive test suite:

```bash
node test-deduplication.js
```

### Test Coverage

1. **Basic Functionality**:
   - Request fingerprinting
   - Cache hit/miss scenarios
   - Response consistency

2. **Concurrency Testing**:
   - Multiple simultaneous requests
   - In-flight request handling
   - Race condition prevention

3. **Cache Management**:
   - Cache invalidation
   - TTL behavior
   - Manual cache clearing

4. **Performance Testing**:
   - Load testing with multiple requests
   - Response time measurements
   - Cache hit rate analysis

5. **Error Handling**:
   - Invalid requests
   - Network failures
   - Cache service unavailability

## Configuration

### Environment Variables

```bash
# Redis configuration
REDIS_URL=redis://localhost:6379

# Enable/disable de-duplication
DEDUPLICATION_ENABLED=true

# Default TTL (seconds)
DEDUPLICATION_DEFAULT_TTL=60
```

### Service Configuration

```javascript
// Custom TTL configuration
const operationTTLs = {
  'tvl_calculation': 180,     // 3 minutes
  'accounting_export': 600,   // 10 minutes
  'vault_export': 600,        // 10 minutes
  'realized_gains': 300,     // 5 minutes
  'token_distribution': 180,  // 3 minutes
  'default': 60               // 1 minute
};
```

## Best Practices

### 1. Cache Key Design
- Use consistent parameter ordering
- Exclude volatile fields (timestamps, nonces)
- Include user context when relevant

### 2. TTL Management
- Set appropriate TTLs for data freshness
- Consider data update frequency
- Balance performance vs. freshness

### 3. Error Handling
- Graceful degradation when cache unavailable
- Fallback to direct processing
- Comprehensive error logging

### 4. Monitoring
- Track cache hit rates
- Monitor response times
- Alert on performance degradation

## Troubleshooting

### Common Issues

1. **High Cache Miss Rate**:
   - Check request parameter consistency
   - Verify cache TTL configuration
   - Monitor cache invalidation frequency

2. **Memory Usage**:
   - Monitor Redis memory usage
   - Adjust TTL values if needed
   - Implement cache size limits

3. **Stale Data**:
   - Review cache invalidation logic
   - Check data update triggers
   - Verify TTL configuration

### Debug Tools

```bash
# Check Redis cache
redis-cli keys "dedup:*"

# Monitor cache operations
redis-cli monitor

# Check in-flight requests
curl http://localhost:4000/api/admin/deduplication/stats
```

## Future Enhancements

### Planned Features

1. **Advanced Caching**:
   - Multi-level caching (L1: in-memory, L2: Redis)
   - Cache warming strategies
   - Predictive caching

2. **Performance Optimization**:
   - Request batching
   - Async processing
   - Background refresh

3. **Monitoring & Analytics**:
   - Detailed performance metrics
   - Cache optimization suggestions
   - Automated alerting

4. **Configuration Management**:
   - Dynamic TTL adjustment
   - A/B testing support
   - Feature flags

## Conclusion

The request de-duplication system significantly improves the performance and reliability of heavy cap-table aggregation operations. By preventing duplicate processing and implementing intelligent caching, the system ensures:

- **Better Performance**: Faster response times through caching
- **Reduced Load**: Less database pressure from duplicate queries
- **Improved Reliability**: Better handling of concurrent requests
- **Scalability**: Ability to handle increased traffic efficiently

The implementation is production-ready and includes comprehensive testing, monitoring, and management capabilities.
