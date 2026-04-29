const cron = require('node-cron');
const { Vault } = require('../models');
const { sequelize } = require('../database/connection');
const axios = require('axios');
const { executeRpcWithRetry } = require('../../../rpc-retry');

class VaultReconciliationJob {
  constructor() {
    this.cronSchedule = '0 */6 * * *'; // Run every 6 hours
    this.contractAddress = process.env.VAULT_CONTRACT_ADDRESS;
    this.stellarRpcUrl = process.env.STELLAR_RPC_URL;

    if (!this.contractAddress) {
      throw new Error('VAULT_CONTRACT_ADDRESS environment variable is required');
    }
    if (!this.stellarRpcUrl) {
      throw new Error('STELLAR_RPC_URL environment variable is required');
    }
  }

  start() {
    console.log('Initializing Vault Reconciliation Job...');
    cron.schedule(this.cronSchedule, async () => {
      console.log('Running Vault Reconciliation Job...');
      try {
        await this.reconcileVaults();
      } catch (error) {
        console.error('Error running Vault Reconciliation Job:', error);
      }
    });
  }

  async reconcileVaults() {
    console.log('Starting vault reconciliation process...');
    
    try {
      // Get on-chain vault count from contract
      const onChainVaultCount = await this.getOnChainVaultCount();
      console.log(`On-chain vault count: ${onChainVaultCount}`);

      // Get database vault count
      const dbVaultCount = await this.getDatabaseVaultCount();
      console.log(`Database vault count: ${dbVaultCount}`);

      // Compare counts
      if (onChainVaultCount !== dbVaultCount) {
        console.warn(`Vault count mismatch detected! On-chain: ${onChainVaultCount}, DB: ${dbVaultCount}`);
        await this.triggerBackfill(onChainVaultCount, dbVaultCount);
      } else {
        console.log('Vault counts match. No reconciliation needed.');
      }

    } catch (error) {
      console.error('Error during vault reconciliation:', error);
      throw error;
    }
  }

  async getOnChainVaultCount() {
    try {
      // This is a placeholder implementation
      // In a real implementation, you would use the Stellar SDK to query the contract
      // for the total_vault_count function or similar
      
      console.log(`Querying contract ${this.contractAddress} for total vault count...`);
      
      // Example implementation using Stellar SDK (commented out as SDK usage needs to be verified)
      /*
      const { Server } = require('stellar-sdk');
      const server = new Server(this.stellarRpcUrl);
      
      // You would need to implement the actual contract call here
      // This depends on your specific contract implementation
      const result = await server.loadAccount(this.contractAddress);
      // Parse the result to get vault count
      */
      
      // For now, return a mock value - replace with actual contract call
      const rpcCall = () =>
        axios.get(`${this.stellarRpcUrl}/contracts/${this.contractAddress}/vault_count`, {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        });

      const response = await executeRpcWithRetry(rpcCall, 'getOnChainVaultCount');
      return parseInt(response.data.count, 10);
    } catch (error) {
      console.error('Error fetching on-chain vault count:', error);
      
      // Fallback: try to estimate from existing data or throw
      if (error.response?.status === 404) {
        console.warn('Contract endpoint not found, using fallback method');
        // You might need to implement a different approach here
        throw new Error('Unable to fetch on-chain vault count: contract endpoint not available');
      }
      
      throw error;
    }
  }

  async getDatabaseVaultCount() {
    try {
      const count = await Vault.count();
      return count;
    } catch (error) {
      console.error('Error fetching database vault count:', error);
      throw error;
    }
  }

  async triggerBackfill(onChainCount, dbCount) {
    console.log(`Triggering backfill job. On-chain: ${onChainCount}, DB: ${dbCount}`);
    
    try {
      // Log the reconciliation event
      await this.logReconciliationEvent(onChainCount, dbCount);

      // Trigger backfill process
      // This could be a separate job, queue, or direct processing
      await this.performBackfill();
      
    } catch (error) {
      console.error('Error during backfill trigger:', error);
      throw error;
    }
  }

  async logReconciliationEvent(onChainCount, dbCount) {
    try {
      // You could store reconciliation logs in a separate table
      // For now, we'll just log to console
      const logEntry = {
        timestamp: new Date().toISOString(),
        onChainCount,
        dbCount,
        mismatch: onChainCount - dbCount,
        status: 'backfill_triggered'
      };
      
      console.log('Reconciliation log:', JSON.stringify(logEntry, null, 2));
      
      // TODO: Store in database if needed
      // await ReconciliationLog.create(logEntry);
      
    } catch (error) {
      console.error('Error logging reconciliation event:', error);
    }
  }

  async performBackfill() {
    console.log('Starting backfill process...');
    
    try {
      // This is where you would implement the actual backfill logic
      // Steps might include:
      // 1. Fetch all vault events from the contract
      // 2. Identify missing vaults in the database
      // 3. Insert missing vault records
      
      // Example placeholder implementation:
      const missingVaults = await this.findMissingVaults();
      
      if (missingVaults.length > 0) {
        console.log(`Found ${missingVaults.length} missing vaults. Starting backfill...`);
        
        for (const vaultData of missingVaults) {
          try {
            await Vault.create({
              address: vaultData.address,
              token_address: vaultData.token_address,
              owner_address: vaultData.owner_address,
              total_amount: vaultData.total_amount,
              name: vaultData.name || `Backfilled Vault ${vaultData.address.slice(0, 8)}...`,
              created_at: new Date(vaultData.created_timestamp),
              updated_at: new Date()
            });
            
            console.log(`Backfilled vault: ${vaultData.address}`);
          } catch (createError) {
            console.error(`Error backfilling vault ${vaultData.address}:`, createError);
          }
        }
        
        console.log('Backfill process completed.');
      } else {
        console.log('No missing vaults found.');
      }
      
    } catch (error) {
      console.error('Error during backfill process:', error);
      throw error;
    }
  }

  async findMissingVaults() {
    // This is a placeholder implementation
    // In a real implementation, you would:
    // 1. Query the contract for all vault events
    // 2. Compare with database records
    // 3. Return missing vaults
    
    try {
      console.log('Searching for missing vaults...');
      
      // Placeholder: fetch from contract API
      const rpcCall = () =>
        axios.get(`${this.stellarRpcUrl}/contracts/${this.contractAddress}/vaults`, {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        });

      const response = await executeRpcWithRetry(rpcCall, 'findMissingVaults');
      const onChainVaults = response.data.vaults || [];
      const dbVaults = await Vault.findAll({ attributes: ['address'] });
      const dbVaultAddresses = new Set(dbVaults.map(v => v.address));
      
      const missingVaults = onChainVaults.filter(vault => !dbVaultAddresses.has(vault.address));
      
      console.log(`Found ${missingVaults.length} missing vaults out of ${onChainVaults.length} total on-chain vaults`);
      
      return missingVaults;
      
    } catch (error) {
      console.error('Error finding missing vaults:', error);
      throw error;
    }
  }

  // Manual trigger method for testing or emergency reconciliation
  async runManually() {
    console.log('Manually triggering vault reconciliation...');
    try {
      await this.reconcileVaults();
      console.log('Manual reconciliation completed successfully.');
    } catch (error) {
      console.error('Manual reconciliation failed:', error);
      throw error;
    }
  }

  async monitorRoundingDrift(vault, onChainVestedAmount) {
    const dbAmount = parseFloat(vault.total_amount);
    const expectedAmount = parseFloat(onChainVestedAmount);
    const drift = Math.abs(dbAmount - expectedAmount);
    const EPSILON = 0.0000001;

    if (drift > EPSILON) {
      console.warn(`[PRECISION MONITOR] Drift detected for vault ${vault.address}: ${drift}`);
      await this.logPrecisionError(vault.address, dbAmount, expectedAmount, drift);
    }
  }

  async logPrecisionError(address, dbVal, chainVal, drift) {
    console.error(JSON.stringify({
      event: 'ROUNDING_ERROR_DETECTED',
      address,
      database_value: dbVal,
      on_chain_value: chainVal,
      drift,
      severity: drift > 0.01 ? 'HIGH' : 'LOW'
    }));
  }

}

module.exports = { VaultReconciliationJob };