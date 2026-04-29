const {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} = require('@stellar/stellar-sdk');
const { AssetDecimalNormalizer } = require('./assetDecimalNormalizer');
const { DatabaseCircuitBreaker } = require('../utils/databaseCircuitBreaker');

/**
 * Service for managing vesting schedules including consolidation and merging functionality.
 */
class VestingScheduleManager {
  constructor(config) {
    this.config = config;
    this.server = config.soroban.rpcUrl ? new rpc.Server(config.soroban.rpcUrl) : null;
    this.contractId = config.soroban.contractId;
    this.decimalNormalizer = new AssetDecimalNormalizer();
    
    // Initialize database circuit breaker for mass unlock protection
    this.databaseCircuitBreaker = new DatabaseCircuitBreaker({
      failureThreshold: config.databaseCircuitBreaker?.failureThreshold || 15,
      resetTimeout: config.databaseCircuitBreaker?.resetTimeout || 180000,
      maxConcurrentWrites: config.databaseCircuitBreaker?.maxConcurrentWrites || 30,
      writeTimeoutThreshold: config.databaseCircuitBreaker?.writeTimeoutThreshold || 3000,
      massUnlockThreshold: config.databaseCircuitBreaker?.massUnlockThreshold || 50,
      massUnlockWindow: config.databaseCircuitBreaker?.massUnlockWindow || 60000,
      batchSize: config.databaseCircuitBreaker?.batchSize || 5,
      onStateChange: (stateChange) => {
        console.warn('VestingScheduleManager Database Circuit Breaker state change', stateChange);
      },
      onMassUnlockDetected: (massUnlock) => {
        console.warn('VestingScheduleManager Mass unlock event detected', massUnlock);
      },
      onThrottlingAdjustment: (adjustment) => {
        console.info('VestingScheduleManager Database throttling adjusted', adjustment);
      }
    });
  }

  getContract() {
    return new Contract(this.contractId);
  }

  /**
   * Execute database operation through circuit breaker for mass unlock protection
   */
  async executeDatabaseOperation(operation, context = {}) {
    try {
      return await this.databaseCircuitBreaker.executeWrite(operation, {
        operation: `vesting_${context.operation || 'unknown'}`,
        beneficiaryAddress: context.beneficiaryAddress,
        scheduleId: context.scheduleId
      });
    } catch (error) {
      // Check if this is a circuit breaker error
      if (error.message.includes('circuit breaker') || 
          error.message.includes('Maximum concurrent writes') ||
          error.message.includes('Database write timeout')) {
        console.warn('VestingScheduleManager database operation rejected by circuit breaker', {
          operation: context.operation,
          circuitBreakerState: this.databaseCircuitBreaker.getState().state,
          error: error.message
        });
        throw new Error(`Database circuit breaker active: ${error.message}`);
      }
      
      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Get circuit breaker statistics for monitoring
   */
  getCircuitBreakerStats() {
    return this.databaseCircuitBreaker.getState();
  }

  async consolidateSchedules(beneficiaryAddress, scheduleId1, scheduleId2, adminPublicKey, adminSignature) {
    this.assertConfigured();

    const schedule1 = await this.getScheduleDetails(scheduleId1);
    const schedule2 = await this.getScheduleDetails(scheduleId2);

    if (schedule1.beneficiary !== schedule2.beneficiary || 
        schedule1.beneficiary !== beneficiaryAddress) {
      const error = new Error('Schedule beneficiary mismatch');
      error.statusCode = 400;
      throw error;
    }

    // Determine the result asset code (prefer the first schedule's asset)
    const resultAssetCode = schedule1.assetCode || schedule2.assetCode || 'XLM';
    
    const consolidatedUnvestedBalance = this.sumUnvestedBalances(schedule1, schedule2, resultAssetCode);
    const weightedAverageCliff = this.calculateWeightedAverageDate(schedule1, schedule2, 'cliff', resultAssetCode);
    const weightedAverageEnd = this.calculateWeightedAverageDate(schedule1, schedule2, 'end', resultAssetCode);
    const consolidatedStartDate = this.earlierDate(schedule1.startDate, schedule2.startDate);
    const weightedAverageDuration = this.calculateWeightedAverageDuration(
      schedule1, 
      schedule2, 
      consolidatedUnvestedBalance,
      resultAssetCode
    );

    const sourceKeypair = Keypair.fromSecret(this.config.soroban.sourceSecret);
    const contract = this.getContract();

    try {
      const sourceAccount = await this.server.getAccount(sourceKeypair.publicKey());
      
      const consolidateOp = contract.call(
        'consolidate_schedules',
        Address.fromString(beneficiaryAddress).toScVal(),
        nativeToScVal(scheduleId1, { type: 'string' }),
        nativeToScVal(scheduleId2, { type: 'string' }),
        nativeToScVal(adminPublicKey, { type: 'string' }),
        nativeToScVal(adminSignature, { type: 'string' })
      );

      const tx = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.config.soroban.networkPassphrase,
      })
        .addOperation(consolidateOp)
        .setTimeout(30)
        .build();

      tx.sign(sourceKeypair);
      const sentTx = await this.server.sendTransaction(tx);

      if (sentTx.status !== 'PENDING') {
        throw new Error('Transaction not accepted');
      }

      const txResponse = await this.pollTransaction(sentTx.hash);
      
      return {
        success: true,
        transactionHash: sentTx.hash,
        consolidatedSchedule: {
          beneficiary: beneficiaryAddress,
          assetCode: resultAssetCode,
          unvestedBalance: consolidatedUnvestedBalance,
          cliffDate: weightedAverageCliff,
          endDate: weightedAverageEnd,
          startDate: consolidatedStartDate,
          vestingDuration: weightedAverageDuration,
        },
        mergedSchedules: [scheduleId1, scheduleId2],
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Schedule consolidation failed:', error);
      throw new Error(`Failed to consolidate schedules: ${error.message}`);
    }
  }

  async getScheduleDetails(scheduleId) {
    this.assertConfigured();
    const contract = this.getContract();
    const sourceKeypair = Keypair.fromSecret(this.config.soroban.sourceSecret);

    try {
      const sourceAccount = await this.server.getAccount(sourceKeypair.publicKey());
      const tx = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.config.soroban.networkPassphrase,
      })
        .addOperation(contract.call('get_schedule', nativeToScVal(scheduleId, { type: 'string' })))
        .setTimeout(30)
        .build();

      const simulation = await this.server.simulateTransaction(tx);

      if (rpc.Api.isSimulationError(simulation)) {
        throw new Error(`Simulation failed: ${simulation.error || 'unknown error'}`);
      }

      const result = simulation.result ? scValToNative(simulation.result.retval) : null;
      return this.normalizeSchedule(result);
    } catch (error) {
      console.error('Error fetching schedule details:', error);
      throw new Error('Failed to fetch schedule details');
    }
  }

  sumUnvestedBalances(schedule1, schedule2, resultAssetCode = 'XLM') {
    const assetCode1 = schedule1.assetCode || 'XLM';
    const assetCode2 = schedule2.assetCode || 'XLM';
    
    return this.decimalNormalizer.addAmounts(
      schedule1.unvestedBalance || schedule1.unvested_balance || 0,
      assetCode1,
      schedule2.unvestedBalance || schedule2.unvested_balance || 0,
      assetCode2,
      resultAssetCode
    );
  }

  calculateWeightedAverageDate(schedule1, schedule2, dateField, resultAssetCode = 'XLM') {
    const assetCode1 = schedule1.assetCode || 'XLM';
    const assetCode2 = schedule2.assetCode || 'XLM';
    
    // Get normalized balances for accurate weighting
    const normalizedBalance1 = this.decimalNormalizer.toBasePrecision(
      schedule1.unvestedBalance || schedule1.unvested_balance || 0,
      assetCode1
    );
    const normalizedBalance2 = this.decimalNormalizer.toBasePrecision(
      schedule2.unvestedBalance || schedule2.unvested_balance || 0,
      assetCode2
    );
    
    const totalBalance = normalizedBalance1.plus(normalizedBalance2);

    if (totalBalance.isZero()) {
      return schedule1[dateField] || schedule1[`${dateField}_date`];
    }

    const date1 = new Date(schedule1[dateField] || schedule1[`${dateField}_date`]);
    const date2 = new Date(schedule2[dateField] || schedule2[`${dateField}_date`]);

    const timestamp1 = date1.getTime();
    const timestamp2 = date2.getTime();

    // Use BigNumber for precise weighted average calculation
    const weightedTimestamp = normalizedBalance1.multipliedBy(timestamp1)
      .plus(normalizedBalance2.multipliedBy(timestamp2))
      .dividedBy(totalBalance)
      .toNumber();
      
    return new Date(weightedTimestamp).toISOString();
  }

  calculateWeightedAverageDuration(schedule1, schedule2, totalBalance, resultAssetCode = 'XLM') {
    const assetCode1 = schedule1.assetCode || 'XLM';
    const assetCode2 = schedule2.assetCode || 'XLM';
    
    // Get normalized balances for accurate weighting
    const normalizedBalance1 = this.decimalNormalizer.toBasePrecision(
      schedule1.unvestedBalance || schedule1.unvested_balance || 0,
      assetCode1
    );
    const normalizedBalance2 = this.decimalNormalizer.toBasePrecision(
      schedule2.unvestedBalance || schedule2.unvested_balance || 0,
      assetCode2
    );
    
    const totalNormalizedBalance = normalizedBalance1.plus(normalizedBalance2);

    if (totalNormalizedBalance.isZero()) {
      return Number(schedule1.vestingDuration || schedule1.vesting_duration || 0);
    }

    const duration1 = Number(schedule1.vestingDuration || schedule1.vesting_duration || 0);
    const duration2 = Number(schedule2.vestingDuration || schedule2.vesting_duration || 0);

    // Use BigNumber for precise weighted average calculation
    const weightedDuration = normalizedBalance1.multipliedBy(duration1)
      .plus(normalizedBalance2.multipliedBy(duration2))
      .dividedBy(totalNormalizedBalance)
      .decimalPlaces(0) // Floor to get integer duration
      .toNumber();

    return weightedDuration;
  }

  earlierDate(date1, date2) {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    return d1 <= d2 ? date1 : date2;
  }

  normalizeSchedule(result) {
    if (!result || typeof result !== 'object') {
      return {
        id: '',
        beneficiary: '',
        assetCode: 'XLM',
        unvestedBalance: 0,
        cliff: null,
        end: null,
        startDate: null,
        vestingDuration: 0,
      };
    }

    return {
      id: result.id || result.schedule_id || '',
      beneficiary: result.beneficiary || result.beneficiary_address || '',
      assetCode: result.assetCode || result.asset_code || 'XLM',
      unvestedBalance: Number(result.unvested_balance || result.unvestedBalance || 0),
      cliff: result.cliff || result.cliff_date || null,
      end: result.end || result.end_date || null,
      startDate: result.start_date || result.start || null,
      vestingDuration: Number(result.vesting_duration || result.vestingDuration || 0),
      totalAmount: Number(result.total_amount || result.totalAmount || 0),
      vestedAmount: Number(result.vested_amount || result.vestedAmount || 0),
    };
  }

  async pollTransaction(txHash) {
    const maxAttempts = 10;
    const delayMs = 1000;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await this.server.getTransaction(txHash);
        
        if (response.status === 'SUCCESS') {
          return response;
        }
        
        if (response.status === 'FAILED') {
          throw new Error('Transaction failed');
        }
      } catch (error) {
        if (i === maxAttempts - 1) {
          throw error;
        }
      }

      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    throw new Error('Transaction polling timeout');
  }

  assertConfigured() {
    if (!this.server) {
      const error = new Error('SOROBAN_RPC_URL is required');
      error.statusCode = 503;
      throw error;
    }

    if (!this.config.soroban.sourceSecret) {
      const error = new Error('SOROBAN_SOURCE_SECRET is required');
      error.statusCode = 503;
      throw error;
    }

    if (!this.contractId) {
      const error = new Error('Contract ID is required');
      error.statusCode = 503;
      throw error;
    }
  }
}

module.exports = {
  VestingScheduleManager,
};
