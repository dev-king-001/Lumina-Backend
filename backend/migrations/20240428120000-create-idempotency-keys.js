'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('idempotency_keys', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      key: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true,
      },
      webhook_type: {
        type: Sequelize.STRING(64),
        allowNull: false,
        comment: 'Type of webhook: claim, slack, milestone, email',
      },
      target_endpoint: {
        type: Sequelize.STRING(512),
        allowNull: false,
        comment: 'Target URL or email address',
      },
      payload_hash: {
        type: Sequelize.STRING(64),
        allowNull: false,
        comment: 'SHA-256 hash of the payload for content verification',
      },
      status: {
        type: Sequelize.ENUM('pending', 'processing', 'completed', 'failed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      response_status: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'HTTP status code for webhooks',
      },
      response_body: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Response body for webhooks',
      },
      error_message: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      attempt_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      last_attempt_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
        comment: 'When this idempotency key expires (default 24 hours)',
      },
      created_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
      },
      updated_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
      },
    });

    // Add indexes
    await queryInterface.addIndex('idempotency_keys', ['key'], { unique: true });
    await queryInterface.addIndex('idempotency_keys', ['webhook_type', 'target_endpoint']);
    await queryInterface.addIndex('idempotency_keys', ['status']);
    await queryInterface.addIndex('idempotency_keys', ['expires_at']);
    await queryInterface.addIndex('idempotency_keys', ['created_at']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('idempotency_keys');
  },
};
