'use strict';

/**
 * ClaimCalculator - Service for calculating claimable amounts for vesting schedules
 *
 * Uses the high-precision math engine (BigNumber.js) for all vesting arithmetic
 * to eliminate floating-point rounding errors and dust accumulation.
 */

const BalanceTracker = require('./balanceTracker');
const { TokenType } = require('../models/vault');
const { OverflowError, DivisionByZeroError } = require('../errors/VaultErrors');
const {
  toBN,
  calculateVestedAmount,
  calculateStaticClaimable,
  calculateProportionalShare,
  calculateDynamicClaimable,
  sum,
} = require('../utils/highPrecisionMath');

class ClaimCalculator {
  /**
   * @param {string|null} rpcUrl - Stellar RPC URL for querying balances (optional)
   */
  constructor(rpcUrl = null) {
    this.balanceTracker = new BalanceTracker(rpcUrl);
  }

  /**
   * Calculate claimable amount based on vault token type.
   * @param {Object} vault
   * @param {Object} subSchedule
   * @param {Date}   currentTime
   * @param {Array}  allSubSchedules - required for dynamic vaults
   * @returns {Promise<string>}
   */
  async calculateClaimable(vault, subSchedule, currentTime, allSubSchedules = null) {
    if (vault.token_type === TokenType.DYNAMIC) {
      return this.calculateDynamic(vault, subSchedule, currentTime, allSubSchedules);
    }
    return this.calculateStatic(subSchedule, currentTime);
  }

  /**
   * Static vesting: claimable = vestedAmount - cumulativeClaimed
   * @param {Object} subSchedule
   * @param {Date}   currentTime
   * @returns {string}
   */
  calculateStatic(subSchedule, currentTime) {
    const { elapsedSeconds, totalAllocation, durationSeconds, cumulativeClaimed } =
      this._extractScheduleParams(subSchedule, currentTime);

    return calculateStaticClaimable(
      totalAllocation,
      durationSeconds,
      elapsedSeconds,
      cumulativeClaimed
    ).toFixed(20).replace(/\.?0+$/, '') || '0';
  }

  /**
   * Dynamic vesting: claimable = proportionalShare(actualBalance) - cumulativeClaimed
   * @param {Object} vault
   * @param {Object} subSchedule
   * @param {Date}   currentTime
   * @param {Array}  allSubSchedules
   * @returns {Promise<string>}
   */
  async calculateDynamic(vault, subSchedule, currentTime, allSubSchedules) {
    const actualBalance = await this.balanceTracker.getActualBalance(
      vault.token_address,
      vault.address
    );

    const totalVested = this.calculateTotalVested(allSubSchedules || [subSchedule], currentTime);

    if (toBN(totalVested).isZero()) {
      return '0';
    }

    const { elapsedSeconds, totalAllocation, durationSeconds, cumulativeClaimed } =
      this._extractScheduleParams(subSchedule, currentTime);

    const userVested = calculateVestedAmount(totalAllocation, durationSeconds, elapsedSeconds);

    return calculateDynamicClaimable(
      userVested,
      totalVested,
      actualBalance,
      cumulativeClaimed
    ).toFixed(20).replace(/\.?0+$/, '') || '0';
  }

  /**
   * Sum vested amounts across all subschedules.
   * @param {Array<Object>} subSchedules
   * @param {Date} currentTime
   * @returns {number} Total vested as a number
   */
  calculateTotalVested(subSchedules, currentTime) {
    const amounts = subSchedules.map((ss) => {
      const { elapsedSeconds, totalAllocation, durationSeconds } =
        this._extractScheduleParams(ss, currentTime);
      return calculateVestedAmount(totalAllocation, durationSeconds, elapsedSeconds);
    });

    return sum(amounts).toNumber();
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Extract and normalise schedule parameters, applying cliff logic.
   * @private
   */
  _extractScheduleParams(subSchedule, currentTime) {
    const asOfDate = currentTime instanceof Date ? currentTime : new Date(currentTime);

    const totalAllocation = subSchedule.top_up_amount || 0;
    const durationSeconds = subSchedule.vesting_duration || 0;
    const cumulativeClaimed = subSchedule.cumulative_claimed_amount || 0;

    // Before cliff or before vesting start → nothing vested
    if (
      (subSchedule.cliff_date && asOfDate < subSchedule.cliff_date) ||
      asOfDate < subSchedule.vesting_start_date
    ) {
      return { elapsedSeconds: 0, totalAllocation, durationSeconds, cumulativeClaimed };
    }

    const elapsedMs = asOfDate.getTime() - subSchedule.vesting_start_date.getTime();
    const elapsedSeconds = elapsedMs / 1000;

    return { elapsedSeconds, totalAllocation, durationSeconds, cumulativeClaimed };
  }

  /**
   * Safely multiply and divide: (a * b) / c
   * Kept for backward-compatibility with any callers that reference it directly.
   * @param {number} a
   * @param {number} b
   * @param {number} c
   * @returns {number}
   * @throws {DivisionByZeroError|OverflowError}
   */
  _safeMultiplyDivide(a, b, c) {
    if (c === 0) throw new DivisionByZeroError(a * b);

    const product = a * b;
    if (!isFinite(product)) throw new OverflowError('multiplication', a, b);

    const result = product / c;
    if (!isFinite(result)) throw new OverflowError('division', product, c);

    return result;
  }

  /**
   * Calculate vested amount for a single subschedule (backward-compatible public helper).
   * @param {Object} subSchedule
   * @param {Date}   currentTime
   * @returns {number}
   */
  _calculateVestedAmount(subSchedule, currentTime) {
    const { elapsedSeconds, totalAllocation, durationSeconds } =
      this._extractScheduleParams(subSchedule, currentTime);
    return calculateVestedAmount(totalAllocation, durationSeconds, elapsedSeconds).toNumber();
  }
}

module.exports = ClaimCalculator;
