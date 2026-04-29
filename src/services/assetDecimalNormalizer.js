const BigNumber = require('bignumber.js');

/**
 * Asset Decimal Normalizer for Cross-Asset Vesting Support
 * 
 * This service handles decimal precision normalization for different assets
 * when performing vesting calculations across multiple asset types.
 * 
 * Key features:
 * - Normalizes asset amounts to a common precision for calculations
 * - Supports Stellar assets with different decimal places
 * - Provides precise arithmetic operations for vesting calculations
 * - Maintains backward compatibility with existing vesting logic
 */
class AssetDecimalNormalizer {
  constructor() {
    // Standard decimal places for common Stellar assets
    this.assetDecimals = new Map([
      ['XLM', 7],           // Native Stellar Lumens
      ['USDC', 6],          // USD Coin
      ['EURC', 6],          // EUR Coin
      ['GBPT', 6],          // British Pound Token
      ['BTC', 8],           // Bitcoin (via wrapped tokens)
      ['ETH', 18],          // Ethereum (via wrapped tokens)
      ['wBTC', 8],          // Wrapped Bitcoin
      ['wETH', 18],         // Wrapped Ethereum
    ]);

    // Default precision for unknown assets
    this.defaultDecimals = 7;
    
    // Maximum precision for internal calculations
    this.maxPrecision = 18;
    
    // Configure BigNumber for high precision
    BigNumber.config({
      DECIMAL_PLACES: this.maxPrecision,
      ROUNDING_MODE: BigNumber.ROUND_DOWN,
      EXPONENTIAL_AT: [-50, 50]
    });
  }

  /**
   * Get decimal places for an asset
   * @param {string} assetCode - Asset code (e.g., 'XLM', 'USDC')
   * @returns {number} Number of decimal places
   */
  getAssetDecimals(assetCode) {
    const normalizedCode = assetCode.toUpperCase();
    return this.assetDecimals.get(normalizedCode) || this.defaultDecimals;
  }

  /**
   * Register or update decimal places for an asset
   * @param {string} assetCode - Asset code
   * @param {number} decimals - Number of decimal places
   */
  setAssetDecimals(assetCode, decimals) {
    if (typeof decimals !== 'number' || decimals < 0 || decimals > this.maxPrecision) {
      throw new Error(`Invalid decimal places for ${assetCode}: ${decimals}`);
    }
    this.assetDecimals.set(assetCode.toUpperCase(), decimals);
  }

  /**
   * Normalize an amount to the specified precision
   * @param {string|number|BigNumber} amount - Amount to normalize
   * @param {number} fromDecimals - Current decimal places
   * @param {number} toDecimals - Target decimal places
   * @returns {BigNumber} Normalized amount
   */
  normalizeAmount(amount, fromDecimals, toDecimals) {
    const bnAmount = new BigNumber(amount);
    
    if (fromDecimals === toDecimals) {
      return bnAmount;
    }

    const scaleFactor = new BigNumber(10).pow(toDecimals - fromDecimals);
    return bnAmount.multipliedBy(scaleFactor);
  }

  /**
   * Convert amount from asset-specific decimals to base precision
   * @param {string|number|BigNumber} amount - Amount in asset decimals
   * @param {string} assetCode - Asset code
   * @returns {BigNumber} Amount in base precision
   */
  toBasePrecision(amount, assetCode) {
    const decimals = this.getAssetDecimals(assetCode);
    return this.normalizeAmount(amount, decimals, this.maxPrecision);
  }

  /**
   * Convert amount from base precision to asset-specific decimals
   * @param {string|number|BigNumber} amount - Amount in base precision
   * @param {string} assetCode - Asset code
   * @returns {string} Amount in asset decimals (as string)
   */
  fromBasePrecision(amount, assetCode) {
    const decimals = this.getAssetDecimals(assetCode);
    const normalized = this.normalizeAmount(amount, this.maxPrecision, decimals);
    
    // Round to asset's decimal places and return as string
    return normalized.decimalPlaces(decimals).toString();
  }

  /**
   * Add two amounts from potentially different assets
   * @param {string|number|BigNumber} amount1 - First amount
   * @param {string} assetCode1 - First asset code
   * @param {string|number|BigNumber} amount2 - Second amount
   * @param {string} assetCode2 - Second asset code
   * @param {string} resultAssetCode - Asset code for result (optional)
   * @returns {string} Sum in result asset decimals
   */
  addAmounts(amount1, assetCode1, amount2, assetCode2, resultAssetCode = assetCode1) {
    const base1 = this.toBasePrecision(amount1, assetCode1);
    const base2 = this.toBasePrecision(amount2, assetCode2);
    const sum = base1.plus(base2);
    
    return this.fromBasePrecision(sum, resultAssetCode);
  }

  /**
   * Calculate weighted average for vesting schedules with different assets
   * @param {Array} schedules - Array of schedule objects
   * @param {string} valueField - Field to average (e.g., 'unvestedBalance')
   * @param {string} resultAssetCode - Asset code for result
   * @returns {string} Weighted average in result asset decimals
   */
  calculateWeightedAverage(schedules, valueField, resultAssetCode) {
    let totalWeight = new BigNumber(0);
    let weightedSum = new BigNumber(0);

    for (const schedule of schedules) {
      const amount = new BigNumber(schedule[valueField] || 0);
      const weight = this.toBasePrecision(amount, schedule.assetCode || 'XLM');
      
      totalWeight = totalWeight.plus(weight);
      weightedSum = weightedSum.plus(weight.multipliedBy(amount));
    }

    if (totalWeight.isZero()) {
      return '0';
    }

    const average = weightedSum.dividedBy(totalWeight);
    return this.fromBasePrecision(average, resultAssetCode);
  }

  /**
   * Sum unvested balances across different assets
   * @param {Array} schedules - Array of schedule objects
   * @param {string} resultAssetCode - Asset code for result
   * @returns {string} Total unvested balance in result asset decimals
   */
  sumUnvestedBalances(schedules, resultAssetCode = 'XLM') {
    let total = new BigNumber(0);

    for (const schedule of schedules) {
      const balance = new BigNumber(schedule.unvestedBalance || schedule.unvested_balance || 0);
      const baseBalance = this.toBasePrecision(balance, schedule.assetCode || 'XLM');
      total = total.plus(baseBalance);
    }

    return this.fromBasePrecision(total, resultAssetCode);
  }

  /**
   * Normalize vesting schedule for cross-asset operations
   * @param {Object} schedule - Vesting schedule object
   * @param {string} targetAssetCode - Target asset code
   * @returns {Object} Normalized schedule
   */
  normalizeSchedule(schedule, targetAssetCode = 'XLM') {
    const assetCode = schedule.assetCode || 'XLM';
    
    return {
      ...schedule,
      assetCode: targetAssetCode,
      unvestedBalance: this.addAmounts(
        schedule.unvestedBalance || 0,
        assetCode,
        0,
        targetAssetCode,
        targetAssetCode
      ),
      totalAmount: this.addAmounts(
        schedule.totalAmount || 0,
        assetCode,
        0,
        targetAssetCode,
        targetAssetCode
      ),
      vestedAmount: this.addAmounts(
        schedule.vestedAmount || 0,
        assetCode,
        0,
        targetAssetCode,
        targetAssetCode
      ),
    };
  }

  /**
   * Validate amount precision for an asset
   * @param {string|number|BigNumber} amount - Amount to validate
   * @param {string} assetCode - Asset code
   * @returns {boolean} True if amount is valid for asset precision
   */
  validateAmountPrecision(amount, assetCode) {
    const decimals = this.getAssetDecimals(assetCode);
    const strAmount = amount.toString();
    
    if (strAmount.includes('.')) {
      const decimalPlaces = strAmount.split('.')[1].length;
      return decimalPlaces <= decimals;
    }
    
    return true;
  }

  /**
   * Get supported assets and their decimal places
   * @returns {Object} Map of asset codes to decimal places
   */
  getSupportedAssets() {
    return Object.fromEntries(this.assetDecimals);
  }

  /**
   * Format amount for display with proper decimal places
   * @param {string|number|BigNumber} amount - Amount to format
   * @param {string} assetCode - Asset code
   * @returns {string} Formatted amount
   */
  formatAmount(amount, assetCode) {
    const decimals = this.getAssetDecimals(assetCode);
    const bnAmount = new BigNumber(amount);
    
    return bnAmount.decimalPlaces(decimals).toString();
  }
}

module.exports = {
  AssetDecimalNormalizer,
};
