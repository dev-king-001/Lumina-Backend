'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('vesting_state_reconciliations', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      vault_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'vaults',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      vault_address: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      run_type: {
        type: Sequelize.ENUM('scheduled', 'manual', 'forced'),
        allowNull: false,
        defaultValue: 'scheduled',
      },
      status: {
        type: Sequelize.ENUM('in_sync', 'desync_detected', 'reconciled', 'reconciliation_failed', 'error'),
        allowNull: false,
        defaultValue: 'in_sync',
      },
      checks_performed: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      desync_details: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      off_chain_snapshot: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      on_chain_snapshot: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      ledger_at_check: {
        type: Sequelize.BIGINT,
        allowNull: true,
      },
      precision_drift_total: {
        type: Sequelize.DECIMAL(36, 18),
        allowNull: true,
        defaultValue: 0,
      },
      auto_reconciled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      error_message: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      started_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      completed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      duration_ms: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    });

    await queryInterface.addIndex('vesting_state_reconciliations', ['vault_id']);
    await queryInterface.addIndex('vesting_state_reconciliations', ['vault_address']);
    await queryInterface.addIndex('vesting_state_reconciliations', ['status']);
    await queryInterface.addIndex('vesting_state_reconciliations', ['ledger_at_check']);
    await queryInterface.addIndex('vesting_state_reconciliations', ['started_at']);
    await queryInterface.addIndex('vesting_state_reconciliations', ['run_type', 'started_at']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('vesting_state_reconciliations');
  },
};
