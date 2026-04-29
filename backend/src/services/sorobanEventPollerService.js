const { sequelize } = require('../database/connection');
const { SorobanEvent, IndexerState } = require('../models');
const SorobanRpcClient = require('./sorobanRpcClient');
const Sentry = require('@sentry/node');
const stellarIngestionService = require('./stellarIngestionService');
const LedgerReorgDetector = require('./ledgerReorgDetector');
const LedgerResyncService = require('./ledgerResyncService');
const RpcQueueService = require('./rpcQueueService');

class SorobanEventPollerService {
  constructor(options = {}) {
    this.serviceName = 'soroban-event-poller';
    this.isRunning = false;
    this.pollInterval = options.pollInterval || 30000; // 30 seconds default
    this.batchSize = options.batchSize || 100; // Max ledgers to fetch per poll
    this.maxRetries = options.maxRetries || 3;
    this.contractAddresses = options.contractAddresses || []; // Specific contracts to monitor
    
    // Checkpoint-based backfill configuration for large gaps
    this.gapThreshold = options.gapThreshold || 1000; // Trigger checkpoint backfill when gap exceeds this
    this.checkpointInterval = options.checkpointInterval || 100; // Ledgers between checkpoints during backfill
    this.enableCheckpointBackfill = options.enableCheckpointBackfill !== false; // Enabled by default
    
    // Initialize RPC client
    const rpcUrl = process.env.SOROBAN_RPC_URL || process.env.STELLAR_RPC_URL;
    if (!rpcUrl) {
      throw new Error('SOROBAN_RPC_URL or STELLAR_RPC_URL environment variable is required');
    }
    
    this.rpcClient = new SorobanRpcClient(rpcUrl, {
      timeout: options.rpcTimeout || 15000,
      maxRetries: this.maxRetries
    });

    // Event signatures we're interested in
    this.eventSignatures = {
      VestingScheduleCreated: 'VestingScheduleCreated',
      TokensClaimed: 'TokensClaimed'
    };

    // Initialize reorg detection and resync services
    this.reorgDetector = new LedgerReorgDetector({
      maxReorgDepth: options.maxReorgDepth || 100,
      finalityThreshold: options.finalityThreshold || 32,
      checkInterval: options.reorgCheckInterval || 60000
    });

    this.resyncService = new LedgerResyncService({
      finalityThreshold: options.finalityThreshold || 32,
      resyncBatchSize: options.resyncBatchSize || 50,
      maxResyncDepth: options.maxResyncDepth || 1000
    });

    // Initialize RPC queue service for reliable RPC calls
    this.rpcQueueService = new RpcQueueService({
      maxRetries: options.rpcMaxRetries || 3,
      retryDelay: options.rpcRetryDelay || 2000,
      dlqMaxSize: options.dlqMaxSize || 1000,
      priorityThreshold: options.priorityThreshold || 10
    });
  }

  /**
   * Start the event poller service
   */
  async start() {
    if (this.isRunning) {
      console.warn('Soroban Event Poller Service is already running');
      return;
    }

    console.log('Starting Soroban Event Poller Service...');
    
    // Verify RPC connectivity
    const isHealthy = await this.rpcClient.healthCheck();
    if (!isHealthy) {
      throw new Error('Soroban RPC endpoint is not healthy');
    }

    this.isRunning = true;
    this.startTime = Date.now();
    
    // Run initial poll
    await this.pollEvents();
    
    // Schedule regular polling
    this.intervalId = setInterval(() => {
      this.pollEvents().catch(error => {
        console.error('Error in scheduled poll:', error);
        Sentry.captureException(error, {
          tags: { service: this.serviceName, operation: 'scheduled_poll' }
        });
      });
    }, this.pollInterval);

    console.log(`Soroban Event Poller Service started - polling every ${this.pollInterval/1000} seconds`);
    
    // Start reorg detector
    await this.reorgDetector.start();
    console.log('Ledger Reorg Detector started');
    
    // Start RPC queue service
    await this.rpcQueueService.start();
    console.log('RPC Queue Service started');
  }

  /**
   * Stop the event poller service
   */
  async stop() {
    if (!this.isRunning) {
      console.warn('Soroban Event Poller Service is not running');
      return;
    }

    console.log('Stopping Soroban Event Poller Service...');
    this.isRunning = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    console.log('Soroban Event Poller Service stopped');
    
    // Stop reorg detector
    await this.reorgDetector.stop();
    console.log('Ledger Reorg Detector stopped');
    
    // Stop RPC queue service
    await this.rpcQueueService.stop();
    console.log('RPC Queue Service stopped');
  }

  /**
   * Main polling method
   */
  async pollEvents() {
    if (!this.isRunning) return;

    const pollId = `poll_${Date.now()}`;
    const startTime = Date.now();
    
    try {
      console.log(`[${pollId}] Starting event poll...`);
      
      // Check for reorgs before polling
      if (this.reorgDetector.isRunning) {
        const reorgCheck = await this.reorgDetector.triggerCheck();
        if (reorgCheck.issues.length > 0) {
          console.log(`[${pollId}] Reorg issues detected, skipping poll to allow handling`);
          return;
        }
      }
      
      // Get last processed ledger
      const lastProcessedLedger = await this.getLastProcessedLedger();
      
      // Get latest ledger from network
      const latestLedgerInfo = await this.rpcClient.getLatestLedger();
      const latestLedger = latestLedgerInfo.sequence;
      
      if (latestLedger <= lastProcessedLedger) {
        console.log(`[${pollId}] No new ledgers (latest: ${latestLedger}, last processed: ${lastProcessedLedger})`);
        return;
      }

      // Calculate ledger range to fetch
      const startLedger = lastProcessedLedger + 1;
      const endLedger = Math.min(startLedger + this.batchSize - 1, latestLedger);
      
      console.log(`[${pollId}] Fetching events from ledgers ${startLedger} to ${endLedger}`);
      
      // Fetch events
      const events = await this.fetchEventsInRange(startLedger, endLedger);
      
      // Process events
      const processedCount = await this.processEvents(events, pollId);
      
      // Update last processed ledger
      if (processedCount > 0 || endLedger > lastProcessedLedger) {
        await this.updateLastProcessedLedger(endLedger);
      }
      
      const duration = Date.now() - startTime;
      console.log(`[${pollId}] Poll completed in ${duration}ms - processed ${processedCount} events from ${endLedger - startLedger + 1} ledgers`);
      
    } catch (error) {
      console.error(`[${pollId}] Poll failed:`, error);
      Sentry.captureException(error, {
        tags: { service: this.serviceName, operation: 'poll_events' },
        extra: { poll_id: pollId }
      });
      
      // Don't re-throw to prevent service from stopping
    }
  }

  /**
   * Fetch events from a range of ledgers using RPC queue service
   * @param {number} startLedger - Start ledger sequence (inclusive)
   * @param {number} endLedger - End ledger sequence (inclusive)
   * @returns {Promise<Array>} Array of events
   */
  async fetchEventsInRange(startLedger, endLedger) {
    try {
      const filters = {};
      
      // Filter by contract addresses if specified
      if (this.contractAddresses.length > 0) {
        filters.contractIds = this.contractAddresses;
      }

      // Use RPC queue service for reliable fetching
      const job = await this.rpcQueueService.addRpcJob('getEvents', {
        startLedger,
        endLedger,
        ...filters
      }, {
        priority: 'high', // Event fetching is high priority
        source: 'soroban-event-poller',
        timeout: 30000 // Longer timeout for batch operations
      });

      // Wait for job completion
      const result = await job.finished();
      
      if (result.success) {
        return result.result.events || [];
      } else {
        throw new Error(`RPC job failed: ${result.error?.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error(`Failed to fetch events for ledgers ${startLedger}-${endLedger}:`, error);
      throw error;
    }
  }

  /**
   * Process fetched events
   * @param {Array} events - Array of events from RPC
   * @param {string} pollId - Poll identifier for logging
   * @returns {Promise<number>} Number of events processed
   */
  async processEvents(events, pollId) {
    if (events.length === 0) return 0;

    let processedCount = 0;
    const relevantEvents = events.filter(event => this.isRelevantEvent(event));
    
    console.log(`[${pollId}] Found ${relevantEvents.length} relevant events out of ${events.length} total`);

    for (const event of relevantEvents) {
      try {
        await this.storeEvent(event);
        processedCount++;
      } catch (error) {
        console.error(`[${pollId}] Failed to store event:`, error);
        Sentry.captureException(error, {
          tags: { service: this.serviceName, operation: 'store_event' },
          extra: { event, poll_id: pollId }
        });
      }
    }

    return processedCount;
  }

  /**
   * Check if event is relevant to our use case
   * @param {Object} event - Event object from RPC
   * @returns {boolean} Whether event is relevant
   */
  isRelevantEvent(event) {
    if (!event.type || !event.type.includes('contract')) {
      return false;
    }

    if (!event.body || !event.body.topic || !event.body.data) {
      return false;
    }

    // Check event signature matches our target events
    const topic = event.body.topic;
    return Object.values(this.eventSignatures).some(signature => 
      topic.includes(signature)
    );
  }

  /**
   * Store event in database
   * @param {Object} event - Event object from RPC
   * @returns {Promise<Object>} Created event record
   */
  async storeEvent(event) {
    const eventType = this.extractEventType(event);
    const contractAddress = event.contractId || event.body?.contractId;
    const transactionHash = event.id;
    const ledgerSequence = event.ledger;
    const eventTimestamp = new Date(event.timestamp || Date.now());

    // Check for duplicates
    const existingEvent = await SorobanEvent.findOne({
      where: {
        ledger_sequence: ledgerSequence,
        event_type: eventType,
        transaction_hash: transactionHash
      }
    });

    if (existingEvent) {
      console.warn(`Event already exists: ${eventType} in ledger ${ledgerSequence}`);
      return existingEvent;
    }

    // Create event record
    const eventRecord = await SorobanEvent.create({
      event_type: eventType,
      contract_address: contractAddress,
      transaction_hash: transactionHash,
      ledger_sequence: ledgerSequence,
      event_body: event,
      event_timestamp: eventTimestamp
    });

    console.log(`Stored event: ${eventType} from ledger ${ledgerSequence}`);
    return eventRecord;
  }

  /**
   * Extract event type from event data
   * @param {Object} event - Event object
   * @returns {string} Event type
   */
  extractEventType(event) {
    const topic = event.body?.topic || '';
    
    for (const [type, signature] of Object.entries(this.eventSignatures)) {
      if (topic.includes(signature)) {
        return type;
      }
    }
    
    // Default fallback
    return 'Unknown';
  }

  /**
   * Get last processed ledger sequence
   * @returns {Promise<number>} Last processed ledger
   */
  async getLastProcessedLedger() {
    try {
      const state = await IndexerState.findByPk(this.serviceName);
      if (state) {
        return state.last_ingested_ledger;
      }
      return 0; // Start from beginning if no state exists
    } catch (error) {
      console.error('Error fetching last processed ledger:', error);
      throw error;
    }
  }

  /**
   * Update last processed ledger sequence
   * @param {number} sequence - Ledger sequence
   * @returns {Promise<void>}
   */
  async updateLastProcessedLedger(sequence) {
    try {
      const [state, created] = await IndexerState.findOrCreate({
        where: { service_name: this.serviceName },
        defaults: {
          last_ingested_ledger: sequence,
        }
      });

      if (!created) {
        state.last_ingested_ledger = sequence;
        await state.save();
      }
      
      console.log(`Updated last processed ledger to: ${sequence}`);
    } catch (error) {
      console.error('Error updating last processed ledger:', error);
      throw error;
    }
  }

  /**
   * Get unprocessed events for business logic processing
   * @param {number} limit - Maximum number of events to fetch
   * @returns {Promise<Array>} Array of unprocessed events
   */
  async getUnprocessedEvents(limit = 100) {
    return SorobanEvent.findAll({
      where: { processed: false },
      order: [['ledger_sequence', 'ASC']],
      limit
    });
  }

  /**
   * Mark events as processed
   * @param {Array} eventIds - Array of event IDs to mark as processed
   * @returns {Promise<number>} Number of events updated
   */
  async markEventsProcessed(eventIds) {
    return SorobanEvent.update(
      { processed: true, processing_error: null },
      { where: { id: eventIds } }
    );
  }

  /**
   * Mark event as failed with error message
   * @param {string} eventId - Event ID
   * @param {string} errorMessage - Error message
   * @returns {Promise<Object>} Updated event
   */
  async markEventFailed(eventId, errorMessage) {
    return SorobanEvent.update(
      { processing_error: errorMessage },
      { where: { id: eventId } }
    );
  }

  /**
   * Get service status
   * @returns {Promise<Object>} Service status information
   */
  async getStatus() {
    return {
      isRunning: this.isRunning,
      pollInterval: this.pollInterval,
      batchSize: this.batchSize,
      contractAddresses: this.contractAddresses,
      uptime: this.isRunning ? Date.now() - this.startTime : 0,
      lastPoll: this.lastPollTime,
      serviceName: this.serviceName,
      reorgDetector: this.reorgDetector.getStatus(),
      resyncService: this.resyncService.getStatus(),
      rpcQueueService: await this.rpcQueueService.getStats()
    };
  }

  /**
   * Get reorg detector instance
   * @returns {LedgerReorgDetector} Reorg detector service
   */
  getReorgDetector() {
    return this.reorgDetector;
  }

  /**
   * Get resync service instance
   * @returns {LedgerResyncService} Resync service
   */
  getResyncService() {
    return this.resyncService;
  }

  /**
   * Get RPC queue service instance
   * @returns {RpcQueueService} RPC queue service
   */
  getRpcQueueService() {
    return this.rpcQueueService;
  }

  /**
   * Trigger manual reorg check
   */
  async triggerReorgCheck() {
    return this.reorgDetector.triggerCheck();
  }

  /**
   * Perform full resync
   */
  async performFullResync() {
    return this.resyncService.performFullResync();
  }

  /**
   * Perform targeted resync
   */
  async performTargetedResync(startSequence, endSequence) {
    return this.resyncService.performTargetedResync(startSequence, endSequence);
  }

  /**
   * Validate ledger integrity
   */
  async validateLedgerIntegrity() {
    return this.resyncService.validateLedgerIntegrity();
  }

  /**
   * Add contract address to monitor
   * @param {string} contractAddress - Contract address to monitor
   */
  addContractAddress(contractAddress) {
    if (!this.contractAddresses.includes(contractAddress)) {
      this.contractAddresses.push(contractAddress);
      console.log(`Added contract address to monitoring: ${contractAddress}`);
    }
  }

  /**
   * Remove contract address from monitoring
   * @param {string} contractAddress - Contract address to remove
   */
  removeContractAddress(contractAddress) {
    const index = this.contractAddresses.indexOf(contractAddress);
    if (index > -1) {
      this.contractAddresses.splice(index, 1);
      console.log(`Removed contract address from monitoring: ${contractAddress}`);
    }
  }
}

module.exports = SorobanEventPollerService;
