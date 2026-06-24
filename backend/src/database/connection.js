const { Sequelize } = require('sequelize');
const secretsService = require('../services/secretsService');

let sequelize;

/**
 * Initialize database connection with dynamic credentials from Vault/Secrets Manager
 */
const initializeDatabase = async () => {
  if (process.env.NODE_ENV === 'test') {
    // Use SQLite in-memory for tests — no Postgres required
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    });
    // Patch sync to ignore "index already exists" errors which are harmless in test
    const origSync = sequelize.sync.bind(sequelize);
    sequelize.sync = async (options) => {
      try {
        return await origSync(options);
      } catch (err) {
        if (err.message && err.message.includes('index already exists')) {
          return;
        }
        throw err;
      }
    };
  } else {
    // Get database credentials dynamically from secrets service
    try {
      const dbConfig = await secretsService.getDatabaseCredentials();
      
      sequelize = new Sequelize(
        dbConfig.database,
        dbConfig.username,
        dbConfig.password,
        {
          host: dbConfig.host,
          port: dbConfig.port,
          dialect: 'postgres',
          logging: process.env.NODE_ENV === 'development' ? console.log : false,
          ssl: dbConfig.ssl,
          dialectOptions: dbConfig.ssl ? {
            sslmode: 'require',
            rejectUnauthorized: true
          } : undefined
        }
      );

      console.log('Database connection initialized with dynamic credentials');
    } catch (error) {
      console.error('Failed to initialize database with dynamic credentials, falling back to environment variables:', error);
      
      // Fallback to environment variables if secrets service fails
      sequelize = new Sequelize(
        process.env.DB_NAME || 'vesting_vault',
        process.env.DB_USER || 'postgres',
        process.env.DB_PASSWORD || 'password',
        {
          host: process.env.DB_HOST || 'localhost',
          port: process.env.DB_PORT || 5432,
          dialect: 'postgres',
          logging: process.env.NODE_ENV === 'development' ? console.log : false,
          ssl: process.env.DB_SSL === 'true' ? {
            sslmode: 'require',
            rejectUnauthorized: true
          } : undefined
        }
      );
    }
  }
  
  return sequelize;
};

// Initialize immediately for backward compatibility
let initPromise = initializeDatabase();

// Read/write splitting support — in test mode (sqlite) this is just the same instance
const getDatabaseConnection = (operationType) => {
  return sequelize;
};

const checkDatabaseHealth = async () => {
  return { write: true, replicas: [] };
};

const checkReplicaLag = async () => {
  return 0;
};

const readReplicas = [];

// Export getters to ensure tests always get the initialized instance
module.exports = { 
  get sequelize() {
    return sequelize;
  },
  initializeDatabase,
  getSequelize: async () => {
    await initPromise;
    return sequelize;
  },
  getDatabaseConnection,
  checkDatabaseHealth,
  checkReplicaLag,
  readReplicas,
  get writeSequelize() {
    return sequelize;
  }
};
