const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connection');

const IdempotencyKey = sequelize.define('IdempotencyKey', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  key: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
  },
  webhook_type: {
    type: DataTypes.STRING(64),
    allowNull: false,
    comment: 'Type of webhook: claim, slack, milestone, email',
  },
  target_endpoint: {
    type: DataTypes.STRING(512),
    allowNull: false,
    comment: 'Target URL or email address',
  },
  payload_hash: {
    type: DataTypes.STRING(64),
    allowNull: false,
    comment: 'SHA-256 hash of the payload for content verification',
  },
  status: {
    type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed'),
    allowNull: false,
    defaultValue: 'pending',
  },
  response_status: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'HTTP status code for webhooks',
  },
  response_body: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Response body for webhooks',
  },
  error_message: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  attempt_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  last_attempt_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: 'When this idempotency key expires (default 24 hours)',
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
  tableName: 'idempotency_keys',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      fields: ['key'],
      unique: true,
    },
    {
      fields: ['webhook_type', 'target_endpoint'],
    },
    {
      fields: ['status'],
    },
    {
      fields: ['expires_at'],
    },
    {
      fields: ['created_at'],
    },
  ],
});

IdempotencyKey.associate = function associate(models) {
  // No direct associations needed for now
  // This model is independent for tracking idempotency across all webhook types
};

module.exports = IdempotencyKey;
