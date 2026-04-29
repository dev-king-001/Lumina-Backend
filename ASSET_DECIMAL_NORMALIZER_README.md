# Asset Decimal Normalizer for Cross-Asset Vesting Support

## Overview

The Asset Decimal Normalizer is a precision handling service designed to support cross-asset vesting operations in the SubStream Protocol backend. It addresses the critical challenge of handling different decimal precisions across various Stellar assets when performing vesting calculations and consolidations.

## Problem Statement

Different assets on the Stellar network have different decimal places:
- **XLM**: 7 decimal places
- **USDC**: 6 decimal places  
- **EURC**: 6 decimal places
- **BTC**: 8 decimal places
- **ETH**: 18 decimal places

When consolidating vesting schedules across different assets, basic JavaScript arithmetic operations can lead to precision errors, especially when dealing with large amounts or small fractional values.

## Solution

The Asset Decimal Normalizer provides:

1. **Precise Arithmetic**: Uses BigNumber.js for high-precision calculations
2. **Asset-Specific Handling**: Maintains decimal precision rules for each asset type
3. **Cross-Asset Operations**: Enables accurate calculations between different assets
4. **Backward Compatibility**: Integrates seamlessly with existing vesting logic

## Features

### Core Functionality

- **Decimal Normalization**: Convert amounts between different decimal precisions
- **Cross-Asset Addition**: Add amounts from different assets with proper precision
- **Weighted Averages**: Calculate weighted averages for vesting schedules
- **Schedule Normalization**: Convert entire schedules to target asset precision
- **Precision Validation**: Validate amounts against asset decimal requirements

### Supported Assets

| Asset | Decimal Places | Description |
|-------|---------------|-------------|
| XLM   | 7             | Native Stellar Lumens |
| USDC  | 6             | USD Coin |
| EURC  | 6             | EUR Coin |
| GBPT  | 6             | British Pound Token |
| BTC   | 8             | Bitcoin (via wrapped tokens) |
| ETH   | 18            | Ethereum (via wrapped tokens) |
| wBTC  | 8             | Wrapped Bitcoin |
| wETH  | 18            | Wrapped Ethereum |

## Installation

The Asset Decimal Normalizer is included as part of the SubStream Protocol backend. Ensure the following dependency is installed:

```json
{
  "dependencies": {
    "bignumber.js": "^9.1.2"
  }
}
```

## Usage

### Basic Operations

```javascript
const { AssetDecimalNormalizer } = require('./src/services/assetDecimalNormalizer');

const normalizer = new AssetDecimalNormalizer();

// Get decimal places for an asset
const xlmDecimals = normalizer.getAssetDecimals('XLM'); // 7
const usdcDecimals = normalizer.getAssetDecimals('USDC'); // 6

// Convert between precisions
const normalized = normalizer.normalizeAmount('1.5', 6, 7); // Convert from 6 to 7 decimals
```

### Cross-Asset Operations

```javascript
// Add amounts from different assets
const sum = normalizer.addAmounts(
  '10000000',  // 1 XLM (7 decimals)
  'XLM',
  '2000000',   // 2 USDC (6 decimals)
  'USDC',
  'XLM'        // Result in XLM
);

// Sum unvested balances across schedules
const schedules = [
  { assetCode: 'XLM', unvestedBalance: '10000000' },
  { assetCode: 'USDC', unvestedBalance: '2000000' }
];

const total = normalizer.sumUnvestedBalances(schedules, 'XLM');
```

### Vesting Schedule Operations

```javascript
// Calculate weighted average for consolidation
const weightedAverage = normalizer.calculateWeightedAverage(
  schedules,
  'unvestedBalance',
  'XLM'
);

// Normalize entire schedule to target asset
const normalizedSchedule = normalizer.normalizeSchedule(schedule, 'XLM');
```

## Integration with VestingScheduleManager

The normalizer is integrated into the `VestingScheduleManager` class:

```javascript
class VestingScheduleManager {
  constructor(config) {
    this.decimalNormalizer = new AssetDecimalNormalizer();
    // ... other initialization
  }

  // Enhanced methods with decimal precision support
  sumUnvestedBalances(schedule1, schedule2, resultAssetCode = 'XLM') {
    // Uses decimal normalizer for precise calculations
  }

  calculateWeightedAverageDate(schedule1, schedule2, dateField, resultAssetCode = 'XLM') {
    // Uses BigNumber for precise weighted averages
  }
}
```

## API Reference

### AssetDecimalNormalizer Class

#### Constructor
```javascript
new AssetDecimalNormalizer()
```

#### Methods

##### `getAssetDecimals(assetCode)`
Returns the number of decimal places for the specified asset.

**Parameters:**
- `assetCode` (string): Asset code (e.g., 'XLM', 'USDC')

**Returns:** Number of decimal places

##### `setAssetDecimals(assetCode, decimals)`
Sets custom decimal places for an asset.

**Parameters:**
- `assetCode` (string): Asset code
- `decimals` (number): Number of decimal places (0-18)

##### `normalizeAmount(amount, fromDecimals, toDecimals)`
Normalizes an amount to the specified precision.

**Parameters:**
- `amount` (string|number|BigNumber): Amount to normalize
- `fromDecimals` (number): Current decimal places
- `toDecimals` (number): Target decimal places

**Returns:** BigNumber - Normalized amount

##### `toBasePrecision(amount, assetCode)`
Converts amount from asset decimals to base precision.

**Parameters:**
- `amount` (string|number|BigNumber): Amount in asset decimals
- `assetCode` (string): Asset code

**Returns:** BigNumber - Amount in base precision

##### `fromBasePrecision(amount, assetCode)`
Converts amount from base precision to asset decimals.

**Parameters:**
- `amount` (string|number|BigNumber): Amount in base precision
- `assetCode` (string): Asset code

**Returns:** String - Amount in asset decimals

##### `addAmounts(amount1, assetCode1, amount2, assetCode2, resultAssetCode)`
Adds two amounts from potentially different assets.

**Parameters:**
- `amount1` (string|number|BigNumber): First amount
- `assetCode1` (string): First asset code
- `amount2` (string|number|BigNumber): Second amount
- `assetCode2` (string): Second asset code
- `resultAssetCode` (string): Asset code for result (optional)

**Returns:** String - Sum in result asset decimals

##### `sumUnvestedBalances(schedules, resultAssetCode)`
Sums unvested balances across different assets.

**Parameters:**
- `schedules` (Array): Array of schedule objects
- `resultAssetCode` (string): Asset code for result

**Returns:** String - Total unvested balance

##### `calculateWeightedAverage(schedules, valueField, resultAssetCode)`
Calculates weighted average for vesting schedules.

**Parameters:**
- `schedules` (Array): Array of schedule objects
- `valueField` (string): Field to average (e.g., 'unvestedBalance')
- `resultAssetCode` (string): Asset code for result

**Returns:** String - Weighted average in result asset decimals

##### `normalizeSchedule(schedule, targetAssetCode)`
Normalizes vesting schedule for cross-asset operations.

**Parameters:**
- `schedule` (Object): Vesting schedule object
- `targetAssetCode` (string): Target asset code

**Returns:** Object - Normalized schedule

##### `validateAmountPrecision(amount, assetCode)`
Validates amount precision for an asset.

**Parameters:**
- `amount` (string|number|BigNumber): Amount to validate
- `assetCode` (string): Asset code

**Returns:** Boolean - True if amount is valid for asset precision

##### `formatAmount(amount, assetCode)`
Formats amount for display with proper decimal places.

**Parameters:**
- `amount` (string|number|BigNumber): Amount to format
- `assetCode` (string): Asset code

**Returns:** String - Formatted amount

## Error Handling

The normalizer includes comprehensive error handling:

```javascript
try {
  const result = normalizer.addAmounts('1000000', 'USDC', '5000000', 'XLM', 'USDC');
} catch (error) {
  console.error('Decimal normalization error:', error.message);
}
```

Common errors:
- Invalid decimal places (must be 0-18)
- Invalid amount format
- Unsupported asset code (uses default decimals)

## Performance Considerations

- **BigNumber.js**: Uses high-precision arithmetic with configurable decimal places
- **Caching**: Asset decimal configurations are cached in memory
- **Efficiency**: Optimized for common vesting operations
- **Memory**: Minimal memory footprint with lazy initialization

## Testing

Comprehensive test suite included:

```bash
# Run Asset Decimal Normalizer tests
npm test assetDecimalNormalizer.test.js

# Run Vesting Schedule Manager tests
npm test vestingScheduleManager.test.js
```

Test coverage includes:
- Basic functionality
- Cross-asset operations
- Precision validation
- Error handling
- Edge cases
- Real-world scenarios

## Migration Guide

### From Basic Arithmetic

Before:
```javascript
// Prone to precision errors
const sum = Number(balance1) + Number(balance2);
const weighted = (timestamp1 * balance1 + timestamp2 * balance2) / totalBalance;
```

After:
```javascript
// Precise calculations
const sum = normalizer.addAmounts(balance1, asset1, balance2, asset2, resultAsset);
const weighted = normalizer.calculateWeightedAverage(schedules, 'unvestedBalance', resultAsset);
```

### Updating Existing Code

1. Import the normalizer
2. Replace basic arithmetic with normalizer methods
3. Add asset codes to schedule objects
4. Update API responses to include asset information

## Best Practices

1. **Always specify asset codes** when working with amounts
2. **Use string representations** for amounts to avoid floating-point errors
3. **Validate precision** before processing amounts
4. **Handle errors gracefully** with try-catch blocks
5. **Test edge cases** including zero amounts and large numbers

## Future Enhancements

- Dynamic asset discovery from Stellar network
- Support for custom asset issuers
- Real-time price integration for value-based calculations
- Enhanced caching for frequently used assets
- Batch processing for multiple operations

## Support

For issues or questions regarding the Asset Decimal Normalizer:

1. Check the test files for usage examples
2. Review the API documentation
3. Consult the migration guide for integration help
4. Create an issue with detailed reproduction steps

---

**Version**: 1.0.0  
**Last Updated**: 2024  
**Compatibility**: Node.js >=20.11.0
