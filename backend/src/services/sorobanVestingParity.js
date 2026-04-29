'use strict';

/**
 * SorobanVestingParity — BigInt-based reimplementation of the Soroban
 * vesting-vault contract's `calculate_claimable_amount` function.
 *
 * The on-chain Rust formula (from contracts/vesting-vault/src/lib.rs:290-314):
 *
 *   fn calculate_claimable_amount(env, vault) -> i128 {
 *       if vault.revoked { return 0; }
 *       let current_time = env.ledger().timestamp();
 *       if current_time < vault.cliff_date { return 0; }
 *       if current_time < vault.vesting_start { return 0; }
 *       let time_since_start = current_time - vault.vesting_start;
 *       let vested_time = min(time_since_start, vault.vesting_duration);
 *       let vested_amount = (vault.total_amount * vested_time) / vault.vesting_duration;
 *       vested_amount.saturating_sub(vault.released_amount)
 *   }
 *
 * Key differences from off-chain JS:
 *   1. Soroban uses i128 INTEGER division — truncates toward zero.
 *   2. JS uses IEEE 754 floating-point — produces fractional results.
 *   3. Over multiple claims, integer truncation causes "dust" that
 *      remains unclaimable on-chain but appears claimable off-chain.
 *
 * This module enables automated parity testing by reproducing the exact
 * on-chain arithmetic in JavaScript using BigInt.
 */

const I128_MAX = (1n << 127n) - 1n;  //  170141183460469231731687303715884105727n
const I128_MIN = -(1n << 127n);       // -170141183460469231731687303715884105728n

class SorobanVestingParity {
  /**
   * Simulate the on-chain `calculate_claimable_amount` using BigInt.
   *
   * @param {Object} params
   * @param {bigint|string|number} params.totalAmount   - Vault total_amount (i128)
   * @param {bigint|string|number} params.releasedAmount - Vault released_amount (i128)
   * @param {bigint|string|number} params.cliffDate     - Cliff timestamp (u64, seconds)
   * @param {bigint|string|number} params.vestingStart  - Vesting start timestamp (u64, seconds)
   * @param {bigint|string|number} params.vestingDuration - Vesting duration (u64, seconds)
   * @param {bigint|string|number} params.currentTime   - Current ledger timestamp (u64, seconds)
   * @param {boolean}              [params.revoked=false] - Whether vault is revoked
   * @returns {bigint} The claimable amount (i128), matching on-chain result
   */
  static calculateClaimableAmount(params) {
    const {
      totalAmount,
      releasedAmount,
      cliffDate,
      vestingStart,
      vestingDuration,
      currentTime,
      revoked = false,
    } = params;

    // Convert all inputs to BigInt (mirrors Soroban i128/u64 types)
    const totalAmountI128 = toBigInt(totalAmount);
    const releasedAmountI128 = toBigInt(releasedAmount);
    const cliffDateU64 = toBigInt(cliffDate);
    const vestingStartU64 = toBigInt(vestingStart);
    const vestingDurationU64 = toBigInt(vestingDuration);
    const currentTimeU64 = toBigInt(currentTime);

    // Revoked vaults return 0
    if (revoked) {
      return 0n;
    }

    // Before cliff — nothing claimable
    if (currentTimeU64 < cliffDateU64) {
      return 0n;
    }

    // Before vesting start — nothing claimable
    if (currentTimeU64 < vestingStartU64) {
      return 0n;
    }

    // Calculate elapsed time since vesting start
    const timeSinceStart = currentTimeU64 - vestingStartU64;

    // Cap at vesting duration (fully vested)
    const vestedTime = timeSinceStart > vestingDurationU64
      ? vestingDurationU64
      : timeSinceStart;

    // Core on-chain formula: (total_amount * vested_time) / vesting_duration
    // This is INTEGER division — truncates toward zero (Rust i128 behavior)
    if (vestingDurationU64 === 0n) {
      return 0n; // Safety: avoid division by zero
    }

    const vestedAmount = (totalAmountI128 * vestedTime) / vestingDurationU64;

    // saturating_sub: if vestedAmount < releasedAmount, return 0 (no negative claims)
    const claimable = vestedAmount > releasedAmountI128
      ? vestedAmount - releasedAmountI128
      : 0n;

    return claimable;
  }

  /**
   * Simulate the on-chain vested amount (before subtracting released).
   * Useful for comparing the raw vesting formula output.
   *
   * @param {Object} params - Same as calculateClaimableAmount minus releasedAmount
   * @returns {bigint} The vested amount (i128)
   */
  static calculateVestedAmount(params) {
    const {
      totalAmount,
      cliffDate,
      vestingStart,
      vestingDuration,
      currentTime,
      revoked = false,
    } = params;

    const totalAmountI128 = toBigInt(totalAmount);
    const cliffDateU64 = toBigInt(cliffDate);
    const vestingStartU64 = toBigInt(vestingStart);
    const vestingDurationU64 = toBigInt(vestingDuration);
    const currentTimeU64 = toBigInt(currentTime);

    if (revoked) return 0n;
    if (currentTimeU64 < cliffDateU64) return 0n;
    if (currentTimeU64 < vestingStartU64) return 0n;
    if (vestingDurationU64 === 0n) return 0n;

    const timeSinceStart = currentTimeU64 - vestingStartU64;
    const vestedTime = timeSinceStart > vestingDurationU64
      ? vestingDurationU64
      : timeSinceStart;

    return (totalAmountI128 * vestedTime) / vestingDurationU64;
  }

  /**
   * Simulate a full multi-claim sequence on-chain.
   * Returns the final state after all claims.
   *
   * @param {Object}  params
   * @param {bigint}  params.totalAmount
   * @param {bigint}  params.cliffDate
   * @param {bigint}  params.vestingStart
   * @param {bigint}  params.vestingDuration
   * @param {bigint[]} params.claimTimestamps - Array of timestamps at which claims occur
   * @returns {Object} { totalReleased: bigint, claims: Array<{timestamp, amount}> }
   */
  static simulateMultiClaim(params) {
    const {
      totalAmount,
      cliffDate,
      vestingStart,
      vestingDuration,
      claimTimestamps,
    } = params;

    let releasedAmount = 0n;
    const claims = [];

    for (const ts of claimTimestamps) {
      const claimable = SorobanVestingParity.calculateClaimableAmount({
        totalAmount,
        releasedAmount,
        cliffDate,
        vestingStart,
        vestingDuration,
        currentTime: ts,
      });

      if (claimable > 0n) {
        releasedAmount += claimable;
        claims.push({ timestamp: ts, amount: claimable });
      }
    }

    return { totalReleased: releasedAmount, claims };
  }

  /**
   * Compare off-chain floating-point result with on-chain integer result.
   * Returns a detailed comparison object.
   *
   * @param {number} offChainResult - The off-chain float result
   * @param {bigint} onChainResult  - The on-chain BigInt result
   * @returns {Object} Comparison details
   */
  static compareResults(offChainResult, onChainResult) {
    const onChainNum = Number(onChainResult);
    const difference = offChainResult - onChainNum;
    const absoluteDifference = Math.abs(difference);

    // The off-chain result should always be >= on-chain due to float having
    // fractional parts that integer division truncates away.
    const offChainGteOnChain = offChainResult >= onChainNum;

    return {
      offChain: offChainResult,
      onChain: onChainNum,
      onChainBigInt: onChainResult,
      difference,
      absoluteDifference,
      offChainGteOnChain,
      // Maximum theoretical drift per claim is (duration - 1) / duration
      // which approaches 1 for large durations
      maxTheoreticalDriftPerClaim: 1,
    };
  }

  /**
   * Run a full parity comparison for a given vesting scenario.
   *
   * @param {Object} scenario
   * @returns {Object} Full parity report
   */
  static runParityCheck(scenario) {
    const {
      totalAmount,
      cliffDate,
      vestingStart,
      vestingDuration,
      currentTime,
      releasedAmount = 0,
    } = scenario;

    // On-chain (BigInt, integer arithmetic)
    const onChainClaimable = SorobanVestingParity.calculateClaimableAmount({
      totalAmount,
      releasedAmount,
      cliffDate,
      vestingStart,
      vestingDuration,
      currentTime,
    });

    // Off-chain (float arithmetic — mirrors ClaimCalculator._calculateVestedAmount)
    const totalAmountNum = Number(totalAmount);
    const vestingStartNum = Number(vestingStart);
    const vestingDurationNum = Number(vestingDuration);
    const currentTimeNum = Number(currentTime);
    const releasedAmountNum = Number(releasedAmount);
    const cliffDateNum = Number(cliffDate);

    let offChainVested = 0;
    if (currentTimeNum >= cliffDateNum && currentTimeNum >= vestingStartNum) {
      const elapsed = currentTimeNum - vestingStartNum;
      const vestedTime = Math.min(elapsed, vestingDurationNum);
      offChainVested = (vestedTime * totalAmountNum) / vestingDurationNum;
    }
    const offChainClaimable = Math.max(0, offChainVested - releasedAmountNum);

    return SorobanVestingParity.compareResults(offChainClaimable, onChainClaimable);
  }
}

/**
 * Convert a value to BigInt, handling strings and numbers.
 * For decimal strings (from DECIMAL columns), truncate to integer part
 * to match Soroban i128 behavior.
 */
function toBigInt(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));

  if (typeof value === 'string') {
    // Handle decimal strings like "100.000000000000000000"
    const dotIndex = value.indexOf('.');
    const intPart = dotIndex >= 0 ? value.slice(0, dotIndex) : value;
    // Handle empty string
    if (intPart === '' || intPart === '-') return 0n;
    return BigInt(intPart);
  }

  return 0n;
}

module.exports = SorobanVestingParity;
