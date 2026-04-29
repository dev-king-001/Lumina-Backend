/**
 * Database Circuit Breaker Monitor Service
 * 
 * Provides monitoring and alerting for database circuit breaker state changes
 * during mass unlock events and high-load scenarios.
 */

class DatabaseCircuitBreakerMonitor {
  constructor(config, dependencies = {}) {
    this.config = config;
    this.logger = dependencies.logger || console;
    this.alertService = dependencies.alertService || null;
    this.emailService = dependencies.emailService || null;
    this.slackService = dependencies.slackService || null;
    
    // Monitoring configuration
    this.enabled = config.enabled !== false;
    this.alertThresholds = {
      failureRate: config.alertThresholds?.failureRate || 0.5, // 50% failure rate
      throttlingLevel: config.alertThresholds?.throttlingLevel || 80, // 80% throttling
      massUnlockCount: config.alertThresholds?.massUnlockCount || 100, // 100 events
      consecutiveFailures: config.alertThresholds?.consecutiveFailures || 10
    };
    
    this.cooldownPeriods = {
      stateChange: config.cooldownPeriods?.stateChange || 300000, // 5 minutes
      massUnlock: config.cooldownPeriods?.massUnlock || 600000, // 10 minutes
      performanceAlert: config.cooldownPeriods?.performanceAlert || 180000 // 3 minutes
    };
    
    // State tracking
    this.lastAlerts = {
      stateChange: null,
      massUnlock: null,
      performanceAlert: null,
      consecutiveFailures: null
    };
    
    this.consecutiveFailureCount = 0;
    this.lastKnownState = null;
    this.monitoringStats = {
      totalAlerts: 0,
      stateChangeAlerts: 0,
      massUnlockAlerts: 0,
      performanceAlerts: 0,
      consecutiveFailureAlerts: 0,
      startTime: new Date().toISOString()
    };
    
    // Performance metrics
    this.performanceHistory = [];
    this.maxHistorySize = 100;
  }

  /**
   * Initialize the monitor
   */
  async initialize() {
    if (!this.enabled) {
      this.logger.info('Database Circuit Breaker Monitor is disabled');
      return;
    }

    this.logger.info('Initializing Database Circuit Breaker Monitor', {
      alertThresholds: this.alertThresholds,
      cooldownPeriods: this.cooldownPeriods
    });

    // Test alert services if available
    if (this.alertService) {
      try {
        await this.alertService.testConnection();
        this.logger.info('Alert service connection verified');
      } catch (error) {
        this.logger.warn('Alert service connection failed', { error: error.message });
      }
    }

    this.logger.info('Database Circuit Breaker Monitor initialized successfully');
  }

  /**
   * Handle circuit breaker state change
   */
  async onStateChange(stateChange) {
    const { fromState, toState, reason, timestamp, stats } = stateChange;
    
    this.logger.warn('Database Circuit Breaker state change detected', stateChange);
    
    // Update consecutive failure count
    if (toState === 'OPEN') {
      this.consecutiveFailureCount++;
    } else if (toState === 'CLOSED') {
      this.consecutiveFailureCount = 0;
    }

    // Check if we should send an alert
    if (this.shouldSendStateChangeAlert(fromState, toState)) {
      await this.sendStateChangeAlert(stateChange);
      this.lastAlerts.stateChange = Date.now();
      this.monitoringStats.stateChangeAlerts++;
    }

    // Update performance history
    this.updatePerformanceHistory({
      timestamp,
      state: toState,
      failureCount: stats.failureCount,
      throttlingLevel: stats.throttlingLevel,
      activeWrites: stats.activeWrites,
      averageWriteTime: stats.averageWriteTime
    });

    this.lastKnownState = toState;
  }

  /**
   * Handle mass unlock detection
   */
  async onMassUnlockDetected(massUnlock) {
    const { eventCount, window, timestamp } = massUnlock;
    
    this.logger.warn('Mass unlock event detected', massUnlock);
    
    // Check if we should send an alert
    if (this.shouldSendMassUnlockAlert(eventCount)) {
      await this.sendMassUnlockAlert(massUnlock);
      this.lastAlerts.massUnlock = Date.now();
      this.monitoringStats.massUnlockAlerts++;
    }
  }

  /**
   * Handle throttling adjustment
   */
  async onThrottlingAdjustment(adjustment) {
    const { oldLevel, newLevel, avgWriteTime, failureRate } = adjustment;
    
    this.logger.info('Database throttling adjusted', adjustment);
    
    // Check if performance degradation requires alerting
    if (this.shouldSendPerformanceAlert(newLevel, avgWriteTime, failureRate)) {
      await this.sendPerformanceAlert({
        type: 'throttling_adjustment',
        timestamp: Date.now(),
        throttlingLevel: newLevel,
        previousLevel: oldLevel,
        averageWriteTime: avgWriteTime,
        failureRate,
        circuitBreakerState: this.lastKnownState
      });
      this.lastAlerts.performanceAlert = Date.now();
      this.monitoringStats.performanceAlerts++;
    }
  }

  /**
   * Check if state change alert should be sent
   */
  shouldSendStateChangeAlert(fromState, toState) {
    // Don't alert for minor state changes
    if (fromState === 'CLOSED' && toState === 'THROTTLING') {
      return false; // This is normal during mass unlocks
    }

    // Check cooldown period
    if (this.lastAlerts.stateChange && 
        Date.now() - this.lastAlerts.stateChange < this.cooldownPeriods.stateChange) {
      return false;
    }

    // Always alert for critical state changes
    return toState === 'OPEN' || (fromState === 'OPEN' && toState === 'CLOSED');
  }

  /**
   * Check if mass unlock alert should be sent
   */
  shouldSendMassUnlockAlert(eventCount) {
    // Check if event count exceeds threshold
    if (eventCount < this.alertThresholds.massUnlockCount) {
      return false;
    }

    // Check cooldown period
    if (this.lastAlerts.massUnlock && 
        Date.now() - this.lastAlerts.massUnlock < this.cooldownPeriods.massUnlock) {
      return false;
    }

    return true;
  }

  /**
   * Check if performance alert should be sent
   */
  shouldSendPerformanceAlert(throttlingLevel, avgWriteTime, failureRate) {
    // Check if any threshold is exceeded
    const throttlingExceeded = throttlingLevel >= this.alertThresholds.throttlingLevel;
    const failureRateExceeded = failureRate >= this.alertThresholds.failureRate;
    
    if (!throttlingExceeded && !failureRateExceeded) {
      return false;
    }

    // Check cooldown period
    if (this.lastAlerts.performanceAlert && 
        Date.now() - this.lastAlerts.performanceAlert < this.cooldownPeriods.performanceAlert) {
      return false;
    }

    return true;
  }

  /**
   * Send state change alert
   */
  async sendStateChangeAlert(stateChange) {
    const { fromState, toState, reason, stats } = stateChange;
    
    const alert = {
      type: 'circuit_breaker_state_change',
      severity: toState === 'OPEN' ? 'critical' : 'warning',
      title: `Database Circuit Breaker: ${fromState} → ${toState}`,
      message: `Database circuit breaker changed from ${fromState} to ${toState}. Reason: ${reason}`,
      timestamp: new Date().toISOString(),
      details: {
        fromState,
        toState,
        reason,
        failureCount: stats.failureCount,
        throttlingLevel: stats.throttlingLevel,
        activeWrites: stats.activeWrites,
        averageWriteTime: stats.averageWriteTime,
        consecutiveFailures: this.consecutiveFailureCount
      },
      actions: [
        'Check database performance metrics',
        'Review recent error logs',
        'Monitor system resources',
        'Consider scaling database resources'
      ]
    };

    await this.sendAlert(alert);
    this.monitoringStats.totalAlerts++;
  }

  /**
   * Send mass unlock alert
   */
  async sendMassUnlockAlert(massUnlock) {
    const { eventCount, window, timestamp } = massUnlock;
    
    const alert = {
      type: 'mass_unlock_detected',
      severity: 'warning',
      title: 'Mass Unlock Event Detected',
      message: `Mass unlock event detected: ${eventCount} events in ${window/1000} seconds`,
      timestamp: new Date().toISOString(),
      details: {
        eventCount,
        window,
        eventsPerSecond: Math.round(eventCount / (window / 1000)),
        circuitBreakerState: this.lastKnownState
      },
      actions: [
        'Monitor circuit breaker status',
        'Check database write performance',
        'Review system resource utilization',
        'Prepare for potential throttling'
      ]
    };

    await this.sendAlert(alert);
    this.monitoringStats.totalAlerts++;
  }

  /**
   * Send performance alert
   */
  async sendPerformanceAlert(performanceData) {
    const { type, throttlingLevel, averageWriteTime, failureRate } = performanceData;
    
    const alert = {
      type: 'performance_degradation',
      severity: 'warning',
      title: 'Database Performance Degradation',
      message: `Database performance degraded: throttling at ${throttlingLevel}%, failure rate: ${(failureRate * 100).toFixed(1)}%`,
      timestamp: new Date().toISOString(),
      details: {
        ...performanceData,
        failureRatePercentage: (failureRate * 100).toFixed(1)
      },
      actions: [
        'Investigate slow queries',
        'Check database connection pool',
        'Monitor system resources',
        'Consider increasing circuit breaker thresholds'
      ]
    };

    await this.sendAlert(alert);
    this.monitoringStats.totalAlerts++;
  }

  /**
   * Send alert through all configured channels
   */
  async sendAlert(alert) {
    const promises = [];

    // Send to alert service
    if (this.alertService) {
      promises.push(
        this.alertService.sendAlert(alert).catch(error => 
          this.logger.error('Failed to send alert to alert service', { error: error.message })
        )
      );
    }

    // Send email
    if (this.emailService && alert.severity === 'critical') {
      promises.push(
        this.emailService.sendAlert(alert).catch(error => 
          this.logger.error('Failed to send alert email', { error: error.message })
        )
      );
    }

    // Send to Slack
    if (this.slackService) {
      promises.push(
        this.slackService.sendAlert(alert).catch(error => 
          this.logger.error('Failed to send Slack alert', { error: error.message })
        )
      );
    }

    // Log alert
    this.logger.error('Database Circuit Breaker Alert', alert);

    // Wait for all alert attempts
    await Promise.allSettled(promises);
  }

  /**
   * Update performance history
   */
  updatePerformanceHistory(metrics) {
    this.performanceHistory.push({
      ...metrics,
      timestamp: Date.now()
    });

    // Keep only recent history
    if (this.performanceHistory.length > this.maxHistorySize) {
      this.performanceHistory = this.performanceHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Get monitoring statistics
   */
  getStats() {
    const uptime = Date.now() - new Date(this.monitoringStats.startTime).getTime();
    
    return {
      ...this.monitoringStats,
      uptime,
      lastKnownState: this.lastKnownState,
      consecutiveFailureCount: this.consecutiveFailureCount,
      lastAlerts: this.lastAlerts,
      performanceHistorySize: this.performanceHistory.length,
      recentPerformance: this.performanceHistory.slice(-10) // Last 10 data points
    };
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary() {
    if (this.performanceHistory.length === 0) {
      return null;
    }

    const recent = this.performanceHistory.slice(-20); // Last 20 data points
    const avgWriteTime = recent.reduce((sum, p) => sum + (p.averageWriteTime || 0), 0) / recent.length;
    const avgThrottlingLevel = recent.reduce((sum, p) => sum + (p.throttlingLevel || 0), 0) / recent.length;
    const maxThrottlingLevel = Math.max(...recent.map(p => p.throttlingLevel || 0));
    const stateDistribution = recent.reduce((acc, p) => {
      acc[p.state] = (acc[p.state] || 0) + 1;
      return acc;
    }, {});

    return {
      period: 'last 20 data points',
      averageWriteTime: Math.round(avgWriteTime),
      averageThrottlingLevel: Math.round(avgThrottlingLevel),
      maxThrottlingLevel,
      stateDistribution,
      dataPoints: recent.length
    };
  }

  /**
   * Reset monitoring statistics
   */
  reset() {
    this.monitoringStats = {
      totalAlerts: 0,
      stateChangeAlerts: 0,
      massUnlockAlerts: 0,
      performanceAlerts: 0,
      consecutiveFailureAlerts: 0,
      startTime: new Date().toISOString()
    };
    this.consecutiveFailureCount = 0;
    this.lastAlerts = {
      stateChange: null,
      massUnlock: null,
      performanceAlert: null,
      consecutiveFailures: null
    };
    this.performanceHistory = [];
    
    this.logger.info('Database Circuit Breaker Monitor statistics reset');
  }
}

module.exports = { DatabaseCircuitBreakerMonitor };
