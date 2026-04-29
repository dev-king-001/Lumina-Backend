# Database Circuit Breaker Implementation

## Overview

This document provides comprehensive documentation for the Database Circuit Breaker implementation designed to protect database write-load during mass unlock events in the vesting vault system.

## Purpose

The circuit breaker pattern prevents database overload during high-frequency events like mass unlocks by:
- Detecting mass unlock patterns
- Throttling database writes intelligently
- Providing graceful degradation instead of complete failure
- Self-healing and automatic recovery

## Architecture

### Core Components

1. **DatabaseCircuitBreaker** (`src/utils/databaseCircuitBreaker.js`)
   - Main circuit breaker implementation
   - State management (CLOSED, OPEN, HALF_OPEN, THROTTLING)
   - Mass unlock detection
   - Intelligent throttling

2. **DatabaseCircuitBreakerMonitor** (`src/services/databaseCircuitBreakerMonitor.js`)
   - Monitoring and alerting service
   - Performance tracking
   - Multi-channel alerting (email, Slack, custom)

3. **Integration Layer** (`src/services/vestingScheduleManager.js`)
   - Circuit breaker integration with vesting operations
   - Database operation wrapper

### Circuit Breaker States

| State | Description | Behavior |
|-------|-------------|----------|
| **CLOSED** | Normal operation | All operations pass through |
| **THROTTLING** | High load detected | Operations are probabilistically throttled |
| **OPEN** | Failure threshold exceeded | All operations are rejected |
| **HALF_OPEN** | Recovery testing | Limited operations allowed to test recovery |

## Configuration

### Environment Variables

```bash
# Core Circuit Breaker Settings
DATABASE_CIRCUIT_BREAKER_FAILURE_THRESHOLD=15          # Failures before opening circuit
DATABASE_CIRCUIT_BREAKER_RESET_TIMEOUT=180000          # Time before attempting reset (ms)
DATABASE_CIRCUIT_BREAKER_MAX_CONCURRENT_WRITES=30      # Maximum simultaneous writes
DATABASE_CIRCUIT_BREAKER_WRITE_TIMEOUT_THRESHOLD=3000  # Write timeout threshold (ms)

# Mass Unlock Detection
DATABASE_CIRCUIT_BREAKER_MASS_UNLOCK_THRESHOLD=50      # Events per minute to trigger mass unlock
DATABASE_CIRCUIT_BREAKER_MASS_UNLOCK_WINDOW=60000       # Time window for detection (ms)

# Batch Processing
DATABASE_CIRCUIT_BREAKER_BATCH_SIZE=5                  # Operations per batch
DATABASE_CIRCUIT_BREAKER_BATCH_TIMEOUT=1000            # Timeout between batches (ms)

# Monitoring Configuration
DATABASE_CIRCUIT_BREAKER_MONITOR_ENABLED=true           # Enable monitoring
DATABASE_CIRCUIT_BREAKER_ALERT_FAILURE_RATE=0.5         # Failure rate alert threshold (50%)
DATABASE_CIRCUIT_BREAKER_ALERT_THROTTLING_LEVEL=80      # Throttling level alert threshold (80%)
DATABASE_CIRCUIT_BREAKER_ALERT_MASS_UNLOCK_COUNT=100     # Mass unlock alert threshold
```

### Configuration Options

| Parameter | Description | Default | Recommended Range |
|-----------|-------------|----------|-------------------|
| `failureThreshold` | Failures before opening circuit | 15 | 10-25 |
| `resetTimeout` | Time before attempting reset (ms) | 180000 | 120000-300000 |
| `maxConcurrentWrites` | Maximum simultaneous writes | 30 | 20-50 |
| `writeTimeoutThreshold` | Write timeout threshold (ms) | 3000 | 2000-5000 |
| `massUnlockThreshold` | Events per minute for mass unlock | 50 | 25-100 |
| `massUnlockWindow` | Detection time window (ms) | 60000 | 30000-120000 |
| `batchSize` | Operations per batch | 5 | 3-10 |
| `batchTimeout` | Timeout between batches (ms) | 1000 | 500-2000 |

## Usage

### Basic Integration

```javascript
const { DatabaseCircuitBreaker } = require('../utils/databaseCircuitBreaker');

// Initialize circuit breaker
const circuitBreaker = new DatabaseCircuitBreaker({
  failureThreshold: 15,
  maxConcurrentWrites: 30,
  massUnlockThreshold: 50,
  onStateChange: (stateChange) => {
    console.log('Circuit breaker state changed:', stateChange);
  }
});

// Execute database operation through circuit breaker
try {
  const result = await circuitBreaker.executeWrite(
    () => database.save(record),
    { operation: 'save_vesting_record', beneficiaryAddress: '0x...' }
  );
  console.log('Operation successful:', result);
} catch (error) {
  if (error.message.includes('circuit breaker')) {
    // Handle circuit breaker rejection
    console.warn('Operation rejected by circuit breaker:', error.message);
  } else {
    // Handle other errors
    throw error;
  }
}
```

### Batch Operations

```javascript
// Execute multiple operations with circuit breaker protection
const operations = [
  () => database.save(record1),
  () => database.save(record2),
  () => database.save(record3),
];

const results = await circuitBreaker.executeBatchWrite(
  operations,
  { operation: 'batch_vesting_update' }
);

// Handle partial failures
results.forEach((result, index) => {
  if (result.error) {
    console.error(`Operation ${index} failed:`, result.error);
  } else {
    console.log(`Operation ${index} succeeded:`, result);
  }
});
```

### Monitoring Integration

```javascript
const { DatabaseCircuitBreakerMonitor } = require('../services/databaseCircuitBreakerMonitor');

// Initialize monitor
const monitor = new DatabaseCircuitBreakerMonitor(
  {
    enabled: true,
    alertThresholds: {
      failureRate: 0.5,
      throttlingLevel: 80,
      massUnlockCount: 100
    }
  },
  {
    logger: console,
    alertService: customAlertService,
    emailService: emailService,
    slackService: slackService
  }
);

// Set up event handlers
circuitBreaker.onStateChange = monitor.onStateChange.bind(monitor);
circuitBreaker.onMassUnlockDetected = monitor.onMassUnlockDetected.bind(monitor);
circuitBreaker.onThrottlingAdjustment = monitor.onThrottlingAdjustment.bind(monitor);
```

## Mass Unlock Detection

The circuit breaker automatically detects mass unlock events by monitoring:

1. **Event Frequency**: Number of events within a time window
2. **Pattern Recognition**: Sudden spikes in database activity
3. **Performance Metrics**: Write times and failure rates

### Detection Algorithm

```javascript
// Mass unlock is detected when:
// - Events per minute exceed threshold
// - AND sustained over the detection window

const eventsPerMinute = recentEventCount / (massUnlockWindow / 60000);
if (eventsPerMinute >= massUnlockThreshold) {
  // Enter throttling mode
  state = 'THROTTLING';
  throttlingLevel = 75; // Start with high throttling
}
```

## Throttling Behavior

### Adaptive Throttling

The circuit breaker uses adaptive throttling based on:

- **Current Load**: Active write operations
- **Performance**: Average write times
- **Failure Rate**: Recent operation failures

### Throttling Levels

| Level | Behavior | Typical Use Case |
|-------|----------|------------------|
| **0-20%** | Minimal throttling | Normal operation recovery |
| **20-50%** | Moderate throttling | Elevated load |
| **50-80%** | High throttling | Mass unlock events |
| **80-100%** | Maximum throttling | Critical overload |

## Monitoring and Alerting

### Available Metrics

- **Circuit Breaker State**: Current state and transition history
- **Performance Metrics**: Write times, success/failure rates
- **Throttling Metrics**: Current throttling level and adjustments
- **Mass Unlock Events**: Detection frequency and duration

### Alert Types

1. **State Change Alerts**
   - Circuit breaker opens or closes
   - Critical for system reliability

2. **Mass Unlock Alerts**
   - Mass unlock events detected
   - Warning level for proactive monitoring

3. **Performance Alerts**
   - High throttling levels
   - Elevated failure rates

### Alert Channels

- **Console Logging**: Always enabled
- **Email**: Critical alerts only
- **Slack**: All alerts
- **Custom Alert Service**: Configurable

## Testing

### Running Tests

```bash
# Run full test suite
npm test -- tests/databaseCircuitBreaker.test.js

# Quick validation without test framework
node validate-circuit-breaker.js
```

### Test Coverage

- ✅ Basic circuit breaker functionality
- ✅ State transitions and recovery
- ✅ Mass unlock detection
- ✅ Throttling behavior
- ✅ Batch processing
- ✅ Concurrent write limits
- ✅ Monitoring and alerting
- ✅ Error handling

### Manual Testing

```javascript
// Simulate mass unlock scenario
async function simulateMassUnlock() {
  const circuitBreaker = new DatabaseCircuitBreaker({
    massUnlockThreshold: 10,
    massUnlockWindow: 1000
  });

  // Generate rapid events to trigger mass unlock detection
  const promises = [];
  for (let i = 0; i < 15; i++) {
    promises.push(
      circuitBreaker.executeWrite(
        () => new Promise(resolve => setTimeout(resolve, 100)),
        { operation: `test_${i}` }
      )
    );
  }

  const results = await Promise.allSettled(promises);
  console.log('Mass unlock simulation results:', results);
}
```

## Troubleshooting

### Common Issues

1. **Circuit Breaker Stuck in OPEN State**
   - Check `resetTimeout` configuration
   - Verify database connectivity
   - Monitor failure rates

2. **Excessive Throttling**
   - Adjust `massUnlockThreshold`
   - Review `writeTimeoutThreshold`
   - Check database performance

3. **False Mass Unlock Detection**
   - Increase `massUnlockThreshold`
   - Adjust `massUnlockWindow`
   - Review application patterns

### Debug Logging

Enable debug logging for detailed troubleshooting:

```bash
LOG_LEVEL=debug
```

### Health Check Integration

```javascript
// Add circuit breaker status to health checks
app.get('/health', (req, res) => {
  const circuitBreakerState = circuitBreaker.getState();
  const health = {
    status: 'healthy',
    circuitBreaker: {
      state: circuitBreakerState.state,
      throttlingLevel: circuitBreakerState.throttlingLevel,
      failureRate: circuitBreakerState.failureRate
    }
  };
  
  if (circuitBreakerState.state === 'OPEN') {
    health.status = 'degraded';
  }
  
  res.json(health);
});
```

## Performance Impact

### Overhead

- **Latency**: ~1-2ms additional per operation
- **Memory**: Minimal footprint for state tracking
- **CPU**: Negligible impact during normal operation

### Benefits

- **Reliability**: Prevents database overload
- **Availability**: Graceful degradation instead of failure
- **Observability**: Comprehensive monitoring
- **Self-healing**: Automatic recovery

## Best Practices

1. **Configuration Tuning**
   - Start with conservative thresholds
   - Monitor and adjust based on actual usage patterns
   - Consider database capacity and performance

2. **Monitoring Setup**
   - Enable all alert channels
   - Set appropriate cooldown periods
   - Monitor circuit breaker state changes

3. **Error Handling**
   - Always handle circuit breaker errors gracefully
   - Provide fallback behavior when possible
   - Log circuit breaker rejections for analysis

4. **Testing**
   - Test mass unlock scenarios regularly
   - Validate configuration changes
   - Monitor performance impact

## Migration Guide

### From No Circuit Breaker

1. **Install Dependencies**: No additional dependencies required
2. **Add Configuration**: Update environment variables
3. **Integrate Code**: Wrap database operations with circuit breaker
4. **Enable Monitoring**: Set up alerting and monitoring
5. **Test**: Validate with mass unlock scenarios

### Configuration Migration

```javascript
// Before
async function saveRecord(record) {
  await database.save(record);
}

// After
async function saveRecord(record) {
  await circuitBreaker.executeWrite(
    () => database.save(record),
    { operation: 'save_record', recordId: record.id }
  );
}
```

## Support

For questions or issues:

1. Check this documentation
2. Review test cases for expected behavior
3. Enable debug logging
4. Contact development team with system details

---

**Version**: 1.0.0  
**Last Updated**: 2026-04-28  
**Compatibility**: Node.js 16+, Vesting Vault Backend
