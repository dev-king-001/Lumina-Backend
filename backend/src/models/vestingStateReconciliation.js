const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connection');

const VestingStateReconciliation = sequelize.define('VestingStateReconciliation', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  vault_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'vaults',
      key: 'id',
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  },
  vault_address: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  run_type: {
    type: DataTypes.ENUM('scheduled', 'manual', 'forced'),
    allowNull: false,
    defaultValue: 'scheduled',
  },
  status: {
    type: DataTypes.ENUM('in_sync', 'desync_detected', 'reconciled', 'reconciliation_failed', 'error'),
    allowNull: false,
    defaultValue: 'in_sync',
  },
  checks_performed: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
    comment: 'Per-check results: subschedule_count, claim_totals, beneficiary_state, vested_amounts, precision_drift',
  },
  desync_details: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Detailed desync findings when status is desync_detected',
  },
  off_chain_snapshot: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Off-chain state snapshot at reconciliation time (subschedule sums, claim totals, beneficiary withdrawals)',
  },
  on_chain_snapshot: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'On-chain state snapshot at reconciliation time (contract read results)',
  },
  ledger_at_check: {
    type: DataTypes.BIGINT,
    allowNull: true,
    comment: 'Ledger sequence at which the on-chain snapshot was taken',
  },
  precision_drift_total: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: true,
    defaultValue: 0,
    comment: 'Cumulative precision drift detected across all subschedules for this vault',
  },
  auto_reconciled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'Whether the desync was auto-reconciled by the worker',
  },
  error_message: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  started_at: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  completed_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  duration_ms: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'vesting_state_reconciliations',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      fields: ['vault_id'],
    },
    {
      fields: ['vault_address'],
    },
    {
      fields: ['status'],
    },
    {
      fields: ['ledger_at_check'],
    },
    {
      fields: ['started_at'],
    },
    {
      fields: ['run_type', 'started_at'],
    },
  ],
});

VestingStateReconciliation.associate = function (models) {
  VestingStateReconciliation.belongsTo(models.Vault, {
    foreignKey: 'vault_id',
    as: 'vault',
  });
};

module.exports = VestingStateReconciliation;
