const TokenUnlockVolumeService = require('../tokenUnlockVolumeService');
const { Vault, SubSchedule, Beneficiary } = require('../../models');

// Mock dependencies
jest.mock('../../models', () => ({
  Vault: { findAll: jest.fn(), findByPk: jest.fn(), create: jest.fn() },
  SubSchedule: { findAll: jest.fn(), findByPk: jest.fn() },
  Beneficiary: { findAll: jest.fn() },
}));
jest.mock('../../database/connection', () => ({
  sequelize: {
    define: jest.fn(),
    transaction: jest.fn(),
    sync: jest.fn(),
    query: jest.fn(),
  },
  initializeDatabase: jest.fn(),
  getSequelize: jest.fn(),
}));
jest.mock('sequelize', () => {
  const { Op } = jest.requireActual('sequelize');
  return {
    Sequelize: jest.fn(),
    Op,
    DataTypes: { DECIMAL: jest.fn(), UUID: jest.fn(), UUIDV4: 'UUIDV4', STRING: jest.fn(), DATE: jest.fn(), BIGINT: jest.fn(), NOW: 'NOW' },
  };
});

describe('TokenUnlockVolumeService', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TokenUnlockVolumeService();
  });

  describe('generateUnlockProjection', () => {
    it('should generate 12-month unlock projection successfully', async () => {
      const mockVaults = [
        {
          id: 'vault-1',
          address: '0x1234567890abcdef',
          name: 'Test Vault',
          token_address: '0xtoken123',
          tag: 'Team',
          subSchedules: [
            {
              id: 'schedule-1',
              cliff_date: new Date('2024-06-01T00:00:00Z'),
              vesting_start_date: new Date('2024-06-01T00:00:00Z'),
              vesting_duration: 31536000, // 1 year in seconds
              top_up_amount: '1000.0000000',
              amount_withdrawn: '0.0000000',
              beneficiaries: [
                { id: 'beneficiary-1' }
              ]
            }
          ]
        }
      ];

      Vault.findAll.mockResolvedValue(mockVaults);

      const result = await service.generateUnlockProjection({
        months: 12,
        startDate: new Date('2024-01-01')
      });

      expect(result.success).toBe(true);
      expect(result.data.projection).toBeDefined();
      expect(result.data.insights).toBeDefined();
      expect(result.data.metadata.totalVaults).toBe(1);
      expect(result.data.metadata.projectionPeriod).toBe(12);
    });

    it('should filter vaults by token address', async () => {
      const tokenAddress = '0xtoken123';
      
      await service.generateUnlockProjection({
        tokenAddress,
        months: 6
      });

      expect(Vault.findAll).toHaveBeenCalledWith({
        where: {
          is_active: true,
          is_blacklisted: false,
          token_address: tokenAddress
        },
        include: [
          {
            model: SubSchedule,
            as: 'subSchedules',
            where: { is_active: true },
            include: [
              {
                model: Beneficiary,
                as: 'beneficiaries'
              }
            ]
          }
        ]
      });
    });

    it('should filter vaults by organization', async () => {
      const orgId = 'org-123';
      
      await service.generateUnlockProjection({
        orgId,
        months: 6
      });

      expect(Vault.findAll).toHaveBeenCalledWith({
        where: {
          is_active: true,
          is_blacklisted: false,
          org_id: orgId
        },
        include: expect.any(Array)
      });
    });

    it('should filter vaults by tags', async () => {
      const vaultTags = ['Team', 'Advisors'];
      
      await service.generateUnlockProjection({
        vaultTags,
        months: 6
      });

      expect(Vault.findAll).toHaveBeenCalledWith({
        where: {
          is_active: true,
          is_blacklisted: false,
          tag: expect.objectContaining({ in: vaultTags })
        },
        include: expect.any(Array)
      });
    });

    it('should handle empty vault list gracefully', async () => {
      Vault.findAll.mockResolvedValue([]);

      const result = await service.generateUnlockProjection();

      expect(result.success).toBe(true);
      expect(typeof result.data.projection).toBe('object');
      expect(result.data.metadata.totalVaults).toBe(0);
    });
  });

  describe('calculateDailyUnlocks', () => {
    it('should calculate daily unlock volumes correctly', () => {
      const vaults = [
        {
          address: '0x1234567890abcdef',
          name: 'Test Vault',
          tag: 'Team',
          subSchedules: [
            {
              cliff_date: new Date('2024-06-01T00:00:00Z'),
              vesting_start_date: new Date('2024-06-01T00:00:00Z'),
              vesting_duration: 31536000, // 1 year
              top_up_amount: '1000.0000000',
              amount_withdrawn: '0.0000000',
              beneficiaries: []
            }
          ]
        }
      ];

      const startDate = new Date('2024-06-01');
      const months = 2;

      const result = service.calculateDailyUnlocks(vaults, startDate, months);

      expect(result).toBeDefined();
      expect(Object.keys(result).length).toBeGreaterThanOrEqual(60); // Approximately 60+ days for 2 months
      
      // Check first day has data structure
      const firstDay = result['2024-06-01'];
      expect(firstDay).toHaveProperty('date', '2024-06-01');
      expect(firstDay).toHaveProperty('totalUnlockAmount');
      expect(firstDay).toHaveProperty('cliffUnlocks');
      expect(firstDay).toHaveProperty('vestingUnlocks');
      expect(firstDay).toHaveProperty('vaultBreakdown');
      expect(firstDay).toHaveProperty('topVaults');
      expect(firstDay).toHaveProperty('cumulativeUnlocked');
    });

    it('should handle multiple vaults correctly', () => {
      const vaults = [
        {
          address: '0x1234567890abcdef',
          name: 'Vault 1',
          tag: 'Team',
          subSchedules: [
            {
              cliff_date: new Date('2024-06-01T00:00:00Z'),
              vesting_start_date: new Date('2024-06-01T00:00:00Z'),
              vesting_duration: 31536000,
              top_up_amount: '1000.0000000',
              amount_withdrawn: '0.0000000',
              beneficiaries: []
            }
          ]
        },
        {
          address: '0xabcdef1234567890',
          name: 'Vault 2',
          tag: 'Advisors',
          subSchedules: [
            {
              cliff_date: new Date('2024-06-15T00:00:00Z'),
              vesting_start_date: new Date('2024-06-01T00:00:00Z'),
              vesting_duration: 31536000,
              top_up_amount: '500.0000000',
              amount_withdrawn: '0.0000000',
              beneficiaries: []
            }
          ]
        }
      ];

      const startDate = new Date('2024-06-01');
      const months = 1;

      const result = service.calculateDailyUnlocks(vaults, startDate, months);

      // Should have data for both vaults
      const cliffDay = result['2024-06-01'];
      expect(cliffDay.vaultBreakdown.length).toBeGreaterThanOrEqual(2);
      
      const secondCliffDay = result['2024-06-15'];
      expect(secondCliffDay.vaultBreakdown.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('calculateScheduleUnlocks', () => {
    it('should calculate cliff unlocks correctly', () => {
      const schedule = {
        cliff_date: new Date('2024-06-01T00:00:00Z'),
        vesting_start_date: new Date('2024-06-01T00:00:00Z'),
        vesting_duration: 31536000,
        top_up_amount: '1000.0000000',
        amount_withdrawn: '0.0000000'
      };

      const startDate = new Date('2024-05-01');
      const endDate = new Date('2024-07-01');

      const unlockEvents = service.calculateScheduleUnlocks(schedule, startDate, endDate);

      expect(unlockEvents.length).toBeGreaterThanOrEqual(1);
      expect(unlockEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            date: expect.any(Date),
            amount: expect.any(String),
            type: 'cliff'
          })
        ])
      );
    });

    it('should calculate daily vesting unlocks correctly', () => {
      const schedule = {
        cliff_date: new Date('2024-06-01T00:00:00Z'),
        vesting_start_date: new Date('2024-06-01T00:00:00Z'),
        vesting_duration: 31536000, // 1 year
        top_up_amount: '1000.0000000',
        amount_withdrawn: '0.0000000'
      };

      const startDate = new Date('2024-06-02'); // After cliff
      const endDate = new Date('2024-06-05');

      const unlockEvents = service.calculateScheduleUnlocks(schedule, startDate, endDate);

      expect(unlockEvents).toHaveLength(3); // 3 days of vesting
      unlockEvents.forEach(event => {
        expect(event.type).toBe('vesting');
        expect(parseFloat(event.amount)).toBeGreaterThan(0);
      });
    });

    it('should skip vesting before cliff date', () => {
      const schedule = {
        cliff_date: new Date('2024-06-15T00:00:00Z'),
        vesting_start_date: new Date('2024-06-01T00:00:00Z'),
        vesting_duration: 31536000,
        top_up_amount: '1000.0000000',
        amount_withdrawn: '0.0000000'
      };

      const startDate = new Date('2024-06-10');
      const endDate = new Date('2024-06-20');

      const unlockEvents = service.calculateScheduleUnlocks(schedule, startDate, endDate);

      // Should not have vesting events before cliff
      const beforeCliffEvents = unlockEvents.filter(event => 
        event.date < new Date('2024-06-15') && event.type === 'vesting'
      );
      expect(beforeCliffEvents).toHaveLength(0);
    });

    it('should return empty array for fully withdrawn schedule', () => {
      const schedule = {
        cliff_date: new Date('2024-06-01T00:00:00Z'),
        vesting_start_date: new Date('2024-06-01T00:00:00Z'),
        vesting_duration: 31536000,
        top_up_amount: '1000.0000000',
        amount_withdrawn: '1000.0000000' // Fully withdrawn
      };

      const startDate = new Date('2024-06-01');
      const endDate = new Date('2024-07-01');

      const unlockEvents = service.calculateScheduleUnlocks(schedule, startDate, endDate);

      expect(unlockEvents).toHaveLength(0);
    });
  });

  describe('calculateCliffAmount', () => {
    it('should calculate 25% cliff amount correctly', () => {
      const schedule = {
        top_up_amount: '1000.0000000',
        cliff_duration: 7776000, // 90 days
        vesting_duration: 31536000
      };

      const cliffAmount = service.calculateCliffAmount(schedule);

      expect(cliffAmount).toBe(250); // 25% of 1000
    });

    it('should handle zero amount correctly', () => {
      const schedule = {
        top_up_amount: '0.0000000',
        cliff_duration: 7776000,
        vesting_duration: 31536000
      };

      const cliffAmount = service.calculateCliffAmount(schedule);

      expect(cliffAmount).toBe(0);
    });
  });

  describe('generateInsights', () => {
    it('should generate comprehensive insights from projection data', () => {
      const projectionData = {
        '2024-06-01': {
          date: '2024-06-01',
          totalUnlockAmount: '1000.0000000',
          cliffUnlocks: '250.0000000',
          vestingUnlocks: '2.7397260',
          cumulativeUnlocked: '1000.0000000'
        },
        '2024-06-02': {
          date: '2024-06-02',
          totalUnlockAmount: '2.7397260',
          cliffUnlocks: '0.0000000',
          vestingUnlocks: '2.7397260',
          cumulativeUnlocked: '1002.7397260'
        }
      };

      const insights = service.generateInsights(projectionData);

      expect(insights).toHaveProperty('summary');
      expect(insights).toHaveProperty('topUnlockDays');
      expect(insights).toHaveProperty('monthlyAggregates');
      expect(insights).toHaveProperty('riskPeriods');
      expect(insights).toHaveProperty('recommendations');

      expect(insights.summary.totalProjectedUnlocks).toBe('1002.7397260');
      expect(insights.summary.peakUnlockDay).toBeDefined();
      expect(insights.summary.totalActiveDays).toBe(2);
    });

    it('should identify peak unlock days correctly', () => {
      const projectionData = {
        '2024-06-01': {
          date: '2024-06-01',
          totalUnlockAmount: '1000.0000000',
          cliffUnlocks: '250.0000000',
          vestingUnlocks: '2.7397260'
        },
        '2024-06-02': {
          date: '2024-06-02',
          totalUnlockAmount: '500.0000000',
          cliffUnlocks: '0.0000000',
          vestingUnlocks: '2.7397260'
        }
      };

      const insights = service.generateInsights(projectionData);

      expect(insights.topUnlockDays).toHaveLength(2);
      expect(insights.topUnlockDays[0].date).toBe('2024-06-01');
      expect(insights.topUnlockDays[0].amount).toBe('1000.0000000');
      expect(insights.topUnlockDays[0].type).toBe('cliff_heavy');
    });
  });

  describe('calculateMonthlyAggregates', () => {
    it('should aggregate daily data into monthly totals', () => {
      const projectionData = {
        '2024-06-01': {
          date: '2024-06-01',
          totalUnlockAmount: '1000.0000000',
          cliffUnlocks: '250.0000000',
          vestingUnlocks: '2.7397260'
        },
        '2024-06-02': {
          date: '2024-06-02',
          totalUnlockAmount: '2.7397260',
          cliffUnlocks: '0.0000000',
          vestingUnlocks: '2.7397260'
        },
        '2024-07-01': {
          date: '2024-07-01',
          totalUnlockAmount: '500.0000000',
          cliffUnlocks: '125.0000000',
          vestingUnlocks: '2.7397260'
        }
      };

      const monthlyAggregates = service.calculateMonthlyAggregates(projectionData);

      expect(monthlyAggregates).toHaveLength(2);
      
      const juneData = monthlyAggregates.find(m => m.month === '2024-06');
      expect(juneData.month).toBe('2024-06');
      expect(juneData.totalUnlocks).toBe('1002.7397260');
      expect(juneData.cliffUnlocks).toBe('250.0000000');
      expect(juneData.vestingUnlocks).toBe('5.4794520');
      expect(juneData.activeDays).toBe(2);
      expect(juneData.peakDay).toBe('2024-06-01');
      expect(juneData.peakAmount).toBe('1000.0000000');

      const julyData = monthlyAggregates.find(m => m.month === '2024-07');
      expect(julyData.month).toBe('2024-07');
      expect(julyData.totalUnlocks).toBe('500.0000000');
      expect(julyData.activeDays).toBe(1);
    });
  });

  describe('identifyRiskPeriods', () => {
    it('should identify periods with high unlock volumes', () => {
      const projectionData = {
        '2024-06-01': { totalUnlockAmount: '100.0000000' },
        '2024-06-02': { totalUnlockAmount: '150.0000000' },
        '2024-06-03': { totalUnlockAmount: '200.0000000' }, // High
        '2024-06-04': { totalUnlockAmount: '120.0000000' },
        '2024-06-05': { totalUnlockAmount: '180.0000000' }, // High
        '2024-06-06': { totalUnlockAmount: '90.0000000' }
      };

      const riskPeriods = service.identifyRiskPeriods(projectionData);

      expect(riskPeriods).toBeDefined();
      expect(riskPeriods.length).toBeGreaterThan(0);
      
      // Check risk periods have required properties
      riskPeriods.forEach(period => {
        expect(period).toHaveProperty('startDate');
        expect(period).toHaveProperty('endDate');
        expect(period).toHaveProperty('peakAmount');
        expect(period).toHaveProperty('totalUnlocks');
        expect(period).toHaveProperty('days');
        expect(period).toHaveProperty('averageDailyUnlocks');
        expect(period).toHaveProperty('riskLevel');
      });
    });

    it('should calculate correct risk levels', () => {
      // Test with mock data that should produce different risk levels
      const projectionData = {};
      
      // Create 30 days of data with varying amounts
      for (let i = 0; i < 30; i++) {
        const date = new Date(2024, 5, i + 1); // June 1-30, 2024
        const dateKey = date.toISOString().split('T')[0];
        
        // Create some high values around day 15
        const amount = i === 14 ? '1000.0000000' : '100.0000000';
        projectionData[dateKey] = { totalUnlockAmount: amount };
      }

      const riskPeriods = service.identifyRiskPeriods(projectionData);

      // Should identify the high-value day as a risk period
      const highRiskPeriod = riskPeriods.find(p => p.peakAmount === '1000.0000000');
      expect(highRiskPeriod).toBeDefined();
      expect(['low', 'medium', 'high', 'critical']).toContain(highRiskPeriod.riskLevel);
    });
  });

  describe('generateRecommendations', () => {
    it('should generate cliff management recommendations', () => {
      const riskPeriods = [];
      const topUnlockDays = [
        { date: '2024-06-01', type: 'cliff_heavy', amount: '1000.0000000' },
        { date: '2024-06-15', type: 'cliff_heavy', amount: '500.0000000' }
      ];

      const recommendations = service.generateRecommendations(riskPeriods, topUnlockDays);

      const cliffRec = recommendations.find(r => r.type === 'cliff_management');
      expect(cliffRec).toBeDefined();
      expect(cliffRec.priority).toBe('high');
      expect(cliffRec.title).toContain('Major Cliff Events');
      expect(cliffRec.actionItems).toContain('Schedule buy-back programs');
      expect(cliffRec.affectedDates).toEqual(['2024-06-01', '2024-06-15']);
    });

    it('should generate risk mitigation recommendations for critical periods', () => {
      const riskPeriods = [
        {
          riskLevel: 'critical',
          totalUnlocks: '5000.0000000',
          days: 3
        }
      ];
      const topUnlockDays = [];

      const recommendations = service.generateRecommendations(riskPeriods, topUnlockDays);

      const riskRec = recommendations.find(r => r.type === 'risk_mitigation');
      expect(riskRec).toBeDefined();
      expect(riskRec.priority).toBe('critical');
      expect(riskRec.title).toContain('Critical Unlock Pressure');
      expect(riskRec.actionItems).toContain('Implement market maker support');
    });

    it('should always include general strategy recommendations', () => {
      const recommendations = service.generateRecommendations([], []);

      const generalRec = recommendations.find(r => r.type === 'general_strategy');
      expect(generalRec).toBeDefined();
      expect(generalRec.priority).toBe('medium');
      expect(generalRec.actionItems).toContain('Set up automated alerts');
    });
  });

  describe('getCurrentUnlockStats', () => {
    it('should calculate current unlock statistics correctly', async () => {
      const mockVaults = [
        {
          subSchedules: [
            {
              top_up_amount: '1000.0000000',
              amount_withdrawn: '200.0000000'
            },
            {
              top_up_amount: '500.0000000',
              amount_withdrawn: '100.0000000'
            }
          ]
        }
      ];

      Vault.findAll.mockResolvedValue(mockVaults);

      // Mock the calculateScheduleUnlocks method
      jest.spyOn(service, 'calculateScheduleUnlocks').mockReturnValue([
        { amount: '50.0000000' }
      ]);

      const result = await service.getCurrentUnlockStats();

      expect(result.success).toBe(true);
      expect(parseFloat(result.data.summary.totalAllocated)).toBeCloseTo(1500, 4);
      expect(parseFloat(result.data.summary.totalUnlockedToDate)).toBeCloseTo(300, 4);
      expect(parseFloat(result.data.summary.remainingLocked)).toBeCloseTo(1200, 4);
      expect(parseFloat(result.data.summary.unlockProgressPercentage)).toBeCloseTo(20, 2);
      expect(parseFloat(result.data.summary.recentUnlocks30Days)).toBeGreaterThan(0);
    });

    it('should handle empty vault list gracefully', async () => {
      Vault.findAll.mockResolvedValue([]);

      const result = await service.getCurrentUnlockStats();

      expect(result.success).toBe(true);
      expect(parseFloat(result.data.summary.totalAllocated)).toBe(0);
      expect(parseFloat(result.data.summary.totalUnlockedToDate)).toBe(0);
      expect(parseFloat(result.data.summary.remainingLocked)).toBe(0);
      expect(parseFloat(result.data.summary.unlockProgressPercentage)).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      Vault.findAll.mockRejectedValue(new Error('Database connection failed'));

      await expect(service.generateUnlockProjection())
        .rejects.toThrow('Database connection failed');
    });

    it('should handle invalid date parameters', async () => {
      Vault.findAll.mockResolvedValue([]);

      const result = await service.generateUnlockProjection({
        startDate: 'invalid-date'
      });

      expect(result.success).toBe(true);
      // Should handle invalid date by using current date
      expect(result.data.metadata.startDate).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should handle large number of vaults efficiently', async () => {
      // Mock 1000 vaults
      const mockVaults = Array.from({ length: 1000 }, (_, i) => ({
        id: `vault-${i}`,
        address: `0x${i.toString().padStart(40, '0')}`,
        subSchedules: [
          {
            cliff_date: new Date('2024-06-01T00:00:00Z'),
            vesting_start_date: new Date('2024-06-01T00:00:00Z'),
            vesting_duration: 31536000,
            top_up_amount: '1000.0000000',
            amount_withdrawn: '0.0000000',
            beneficiaries: []
          }
        ]
      }));

      Vault.findAll.mockResolvedValue(mockVaults);

      const startTime = Date.now();
      const result = await service.generateUnlockProjection({ months: 12 });
      const endTime = Date.now();

      expect(result.success).toBe(true);
      expect(result.data.metadata.totalVaults).toBe(1000);
      
      // Should complete within reasonable time (adjust threshold as needed)
      expect(endTime - startTime).toBeLessThan(10000); // 10 seconds
    });
  });
});
