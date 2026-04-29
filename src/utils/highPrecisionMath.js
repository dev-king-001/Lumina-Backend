'use strict';

const BigNumber = require('bignumber.js');

// Configure BigNumber for vesting calculations:
// - 20 decimal places of precision
// - Round down (floor) to avoid over-paying claimable amounts
// - Disable exponential notation for large/small numbers
BigNumber.config({
  DECIMAL_PLACES: 20,
  ROUNDING_MODE: BigNumber.ROUND_DOWN,
  EXPONENTIAL_AT: [-50, 50],
});

/**
 * High-Precision Math Engine for off-chain vesting projections.
 *
 * All public functions accept number | string | BigNumber inputs and return
 * BigNumber instances so callers can chain operations without precision loss.
 * Convert to string for storage/display via .toFixed() or .toString().
 */

/**
 * Wrap a value in BigNumber, throwing on NaN/Infinity.
 * @param {number|string|BigNumber} value
 * @returns {BigNumber}
 */
function toBN(value) {
  const bn = new BigNumber(value);
  if (bn.isNaN() || !bn.isFinite()) {
    throw new RangeError(`highPrecisionMath: invalid value "${value}"`);
  }
  return bn;
}

/**
 * Calculate the linearly vested amount for a single schedule at a given time.
 *
 * Formula: vestedAmount = (elapsedSeconds / durationSeconds) * totalAllocation
 * Clamped to [0, totalAllocation].
 *
 * @param {number|string|BigNumber} totalAllocation  - Total tokens allocated
 * @param {number|string|BigNumber} durationSeconds  - Total vesting duration in seconds
 * @param {number|string|BigNumber} elapsedSeconds   - Seconds elapsed since vesting start (≥ 0)
 * @returns {BigNumber} Vested amount (never negative, never > totalAllocation)
 */
function calculateVestedAmount(totalAllocation, durationSeconds, elapsedSeconds) {
  const allocation = toBN(totalAllocation);
  const duration = toBN(durationSeconds);
  const elapsed = toBN(elapsedSeconds);

  if (duration.isZero()) {
    // Zero-duration schedule: fully vested immediately
    return allocation;
  }

  if (elapsed.isLessThanOrEqualTo(0)) {
    return new BigNumber(0);
  }

  if (elapsed.isGreaterThanOrEqualTo(duration)) {
    return allocation;
  }

  return elapsed.multipliedBy(allocation).dividedBy(duration);
}

/**
 * Calculate the claimable (net) amount for a static vesting schedule.
 *
 * claimable = vestedAmount - cumulativeClaimed  (floored at 0)
 *
 * @param {number|string|BigNumber} totalAllocation
 * @param {number|string|BigNumber} durationSeconds
 * @param {number|string|BigNumber} elapsedSeconds
 * @param {number|string|BigNumber} cumulativeClaimed
 * @returns {BigNumber}
 */
function calculateStaticClaimable(totalAllocation, durationSeconds, elapsedSeconds, cumulativeClaimed) {
  const vested = calculateVestedAmount(totalAllocation, durationSeconds, elapsedSeconds);
  const claimed = toBN(cumulativeClaimed);
  const claimable = vested.minus(claimed);
  return BigNumber.maximum(claimable, 0);
}

/**
 * Calculate a beneficiary's proportional share of an actual vault balance.
 *
 * share = (userVested / totalVested) * actualBalance
 *
 * Returns 0 if totalVested is zero (nothing has vested yet).
 *
 * @param {number|string|BigNumber} userVested    - This beneficiary's vested amount
 * @param {number|string|BigNumber} totalVested   - Sum of all beneficiaries' vested amounts
 * @param {number|string|BigNumber} actualBalance - Real on-chain vault balance
 * @returns {BigNumber}
 */
function calculateProportionalShare(userVested, totalVested, actualBalance) {
  const uv = toBN(userVested);
  const tv = toBN(totalVested);
  const ab = toBN(actualBalance);

  if (tv.isZero()) {
    return new BigNumber(0);
  }

  return uv.multipliedBy(ab).dividedBy(tv);
}

/**
 * Calculate the claimable amount for a dynamic (proportional) vesting schedule.
 *
 * claimable = proportionalShare - cumulativeClaimed  (floored at 0)
 *
 * @param {number|string|BigNumber} userVested
 * @param {number|string|BigNumber} totalVested
 * @param {number|string|BigNumber} actualBalance
 * @param {number|string|BigNumber} cumulativeClaimed
 * @returns {BigNumber}
 */
function calculateDynamicClaimable(userVested, totalVested, actualBalance, cumulativeClaimed) {
  const share = calculateProportionalShare(userVested, totalVested, actualBalance);
  const claimed = toBN(cumulativeClaimed);
  const claimable = share.minus(claimed);
  return BigNumber.maximum(claimable, 0);
}

/**
 * Sum an array of numeric values with full precision.
 *
 * @param {Array<number|string|BigNumber>} values
 * @returns {BigNumber}
 */
function sum(values) {
  return values.reduce((acc, v) => acc.plus(toBN(v)), new BigNumber(0));
}

module.exports = {
  toBN,
  calculateVestedAmount,
  calculateStaticClaimable,
  calculateProportionalShare,
  calculateDynamicClaimable,
  sum,
};
