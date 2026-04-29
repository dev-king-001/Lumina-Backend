# Idempotency-Key Implementation for Outgoing Webhooks

This document describes the implementation of idempotency-key tracking for all outgoing webhooks in the Vesting Vault backend system.

## Overview

Idempotency keys ensure that webhook deliveries are processed exactly once, preventing duplicate notifications and improving system reliability. This implementation follows industry best practices for webhook idempotency.

## Architecture

### Components

1. **IdempotencyKey Model** - Database table for tracking webhook operations
2. **IdempotencyKeyService** - Service for managing idempotency keys and operations
3. **Updated Webhook Services** - All webhook services now include idempotency handling

### Supported Webhook Types

- **Claim Webhooks** - Token claim notifications to external endpoints
- **Slack Webhooks** - Large claim alerts to Slack channels
- **Milestone Webhooks** - Vesting milestone celebration notifications
- **Email Notifications** - Email alerts and notifications

## Implementation Details

### IdempotencyKey Model

Located at `src/models/idempotencyKey.js`

**Fields:**
- `key` - Unique idempotency key (SHA-256 hash)
- `webhook_type` - Type of webhook (claim, slack, milestone, email)
- `target_endpoint` - Target URL or email address
- `payload_hash` - SHA-256 hash of the payload for content verification
- `status` - Current status (pending, processing, completed, failed)
- `response_status` - HTTP status code for webhooks
- `response_body` - Response body for successful operations
- `error_message` - Error message for failed operations
- `attempt_count` - Number of attempts made
- `last_attempt_at` - Timestamp of last attempt
- `expires_at` - When the idempotency key expires (default 24 hours)

### IdempotencyKeyService

Located at `src/services/idempotencyKeyService.js`

**Key Methods:**
- `generateIdempotencyKey()` - Creates unique idempotency keys
- `checkIdempotencyKey()` - Checks if key exists and is valid
- `createIdempotencyKey()` - Creates new idempotency record
- `executeWithIdempotency()` - Wrapper for idempotent operations
- `markAsProcessing()` - Updates status to processing
- `markAsCompleted()` - Updates status to completed
- `markAsFailed()` - Updates status to failed
- `cleanupExpiredKeys()` - Removes expired keys
- `getStatistics()` - Provides usage statistics

## Integration with Webhook Services

### ClaimWebhookDispatcherService

- Uses `event_key` as the primary idempotency identifier
- Prevents duplicate claim webhook deliveries
- Includes `Idempotency-Key` header in HTTP requests
- Tracks delivery status and response

### SlackWebhookService

- Generates keys based on transaction hash and user address
- Prevents duplicate Slack notifications for large claims
- Caches successful notifications for 24 hours

### MilestoneCelebrationService

- Uses milestone ID and webhook ID for key generation
- Prevents duplicate milestone celebration webhooks
- Supports multiple webhook endpoints per organization

### EmailService

- Generates keys based on recipient, subject, and content
- Prevents duplicate email notifications
- Tracks email delivery status

## Database Migration

Run the migration to create the idempotency_keys table:

```bash
npx sequelize-cli db:migrate --migrations-path ./migrations
```

Migration file: `migrations/20240428120000-create-idempotency-keys.js`

## Configuration

Environment variables:

```bash
# Optional: Custom expiration time in hours (default: 24)
IDEMPOTENCY_KEY_EXPIRATION_HOURS=24

# Optional: Cleanup interval in minutes (default: 60)
IDEMPOTENCY_KEY_CLEANUP_INTERVAL=60
```

## Usage Examples

### Basic Idempotency Check

```javascript
const idempotencyKeyService = require('./services/idempotencyKeyService');

const result = await idempotencyKeyService.executeWithIdempotency(
  'webhook-type',
  'https://example.com/webhook',
  payload,
  async () => {
    // Your webhook logic here
    const response = await axios.post('https://example.com/webhook', payload);
    return {
      success: response.status >= 200 && response.status < 300,
      responseStatus: response.status,
      responseBody: response.data,
    };
  }
);

if (result.fromCache) {
  console.log('Operation was served from cache');
}
```

### Custom Idempotency Key

```javascript
const customKey = 'my-custom-key-123';
const result = await idempotencyKeyService.executeWithIdempotency(
  'webhook-type',
  'https://example.com/webhook',
  payload,
  operation,
  customKey
);
```

## Monitoring and Maintenance

### Statistics

Get idempotency key statistics:

```javascript
const stats = await idempotencyKeyService.getStatistics();
console.log(stats);
// Output:
// {
//   total: 1000,
//   expired: 50,
//   byStatus: {
//     pending: 10,
//     processing: 5,
//     completed: 900,
//     failed: 35
//   }
// }
```

### Cleanup

Expired keys are automatically cleaned up. Manual cleanup can be triggered:

```javascript
const deletedCount = await idempotencyKeyService.cleanupExpiredKeys();
console.log(`Cleaned up ${deletedCount} expired keys`);
```

## Testing

### Unit Tests

```bash
npm test -- idempotencyKeyService.test.js
```

### Integration Tests

```bash
npm test -- idempotencyKeyService.integration.test.js
```

## Security Considerations

1. **Payload Hashing** - All payloads are hashed using SHA-256 to detect tampering
2. **Key Expiration** - Keys expire after 24 hours to prevent unlimited growth
3. **Content Verification** - Payload hashes are verified to ensure consistency
4. **Rate Limiting** - Idempotency checks help prevent abuse

## Performance Impact

- **Database Load** - Additional queries for idempotency checks
- **Memory Usage** - Cached responses reduce repeated processing
- **Network Efficiency** - Prevents duplicate webhook deliveries
- **Storage** - Idempotency records are cleaned up automatically

## Best Practices

1. **Consistent Payloads** - Use consistent payload structures for reliable key generation
2. **Appropriate Expiration** - Set expiration times based on business requirements
3. **Error Handling** - Handle both network errors and idempotency conflicts
4. **Monitoring** - Monitor idempotency key statistics for system health
5. **Testing** - Test both success and failure scenarios

## Troubleshooting

### Common Issues

1. **Duplicate Keys** - Check payload consistency and key generation logic
2. **Expired Keys** - Verify expiration settings and cleanup processes
3. **Database Performance** - Monitor query performance on idempotency_keys table
4. **Memory Leaks** - Ensure cleanup processes are running correctly

### Debug Logging

Enable debug logging to trace idempotency operations:

```bash
DEBUG=idempotency:* npm start
```

## Future Enhancements

1. **Redis Integration** - Use Redis for distributed idempotency tracking
2. **Custom Expiration** - Per-webhook-type expiration settings
3. **Metrics Dashboard** - Real-time monitoring of idempotency usage
4. **Batch Processing** - Bulk idempotency checks for high-volume scenarios

## Conclusion

This idempotency-key implementation provides robust protection against duplicate webhook deliveries while maintaining high performance and reliability. The system is designed to be extensible and can accommodate new webhook types as the platform grows.
