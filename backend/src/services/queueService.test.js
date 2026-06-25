const IORedis = require('ioredis');

jest.mock('ioredis', () => {
  return jest.fn(() => ({
    connect: jest.fn().mockResolvedValue(),
    disconnect: jest.fn().mockResolvedValue(),
    on: jest.fn(),
    status: 'ready'
  }));
});
jest.mock('@sentry/node');

let mockBullQueue;
jest.mock('bullmq', () => ({
  Queue: jest.fn(() => {
    if (!mockBullQueue) {
      mockBullQueue = {
        add: jest.fn().mockResolvedValue({ id: 'job-1', getState: jest.fn().mockResolvedValue('completed'), progress: 100, returnvalue: 'ok' }),
        getJob: jest.fn().mockResolvedValue({ id: 'job-1', getState: jest.fn().mockResolvedValue('completed'), progress: 100, returnvalue: 'ok' })
      };
    }
    return mockBullQueue;
  })
}));

describe('QueueService', () => {
  let queueService;

  beforeEach(() => {
    jest.clearAllMocks();
    if (!mockBullQueue) {
      queueService = require('./queueService');
    }
    // Reset mock implementations on the shared instance
    mockBullQueue.add.mockResolvedValue({ id: 'job-1', getState: jest.fn().mockResolvedValue('completed'), progress: 100, returnvalue: 'ok' });
    mockBullQueue.getJob.mockResolvedValue({ id: 'job-1', getState: jest.fn().mockResolvedValue('completed'), progress: 100, returnvalue: 'ok' });
    if (!queueService) {
      queueService = require('./queueService');
    }
  });

  describe('addGenerateCsvJob', () => {
    it('should add a CSV generation job', async () => {
      const result = await queueService.addGenerateCsvJob(123);
      expect(result).toBeDefined();
    });
  });

  describe('getJobStatus', () => {
    it('should return job status', async () => {
      const status = await queueService.getJobStatus('job-1');
      expect(status).toBeDefined();
      expect(status.state).toBe('completed');
    });

    it('should return null for missing job', async () => {
      mockBullQueue.getJob.mockResolvedValue(null);
      const status = await queueService.getJobStatus('nonexistent');
      expect(status).toBeNull();
    });
  });
});
