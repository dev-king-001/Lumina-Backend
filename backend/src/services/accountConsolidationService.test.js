'use strict';

jest.mock('../models', () => ({
  Beneficiary: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() },
  Vault: {},
  SubSchedule: {},
}));

jest.mock('./auditLogger', () => ({ logAction: jest.fn() }));

const { sequelize } = require('../database/connection');
const { Beneficiary } = require('../models');
const accountConsolidationService = require('./accountConsolidationService');

describe('AccountConsolidationService', () => {
  let mockVault, mockBeneficiary, mockSubSchedule;

  beforeEach(() => {
    jest.clearAllMocks();
    mockVault = {
      id: 'vault-1',
      address: 'VAULT_ADDRESS_1',
      name: 'Test Vault',
      token_address: 'TOKEN_ADDRESS',
      owner_address: 'OWNER_ADDRESS',
      total_amount: '1000',
      is_blacklisted: false,
      org_id: 'org-1',
      tag: 'Team',
    };
    mockBeneficiary = {
      id: 'beneficiary-1',
      vault_id: 'vault-1',
      address: 'BENEFICIARY_ADDRESS',
      total_allocated: '500',
      total_withdrawn: '100',
      email: 'test@example.com',
      email_valid: true,
    };
    mockSubSchedule = {
      id: 'schedule-1',
      vault_id: 'vault-1',
      top_up_amount: '1000',
      cliff_duration: 86400,
      cliff_date: new Date('2023-01-02'),
      vesting_start_date: new Date('2023-01-02'),
      vesting_duration: 31536000,
      start_timestamp: new Date('2023-01-02'),
      end_timestamp: new Date('2024-01-02'),
      transaction_hash: 'TX_HASH',
      amount_withdrawn: '0',
      amount_released: '0',
      is_active: true,
    };
  });

  describe('getConsolidatedView', () => {
    it('should return consolidated view for beneficiary with multiple vaults', async () => {
      const mockBeneficiaries = [
        { ...mockBeneficiary, vault: { ...mockVault, subSchedules: [mockSubSchedule] } },
        {
          ...mockBeneficiary,
          id: 'beneficiary-2',
          vault: {
            ...mockVault,
            id: 'vault-2',
            address: 'VAULT_ADDRESS_2',
            subSchedules: [{ ...mockSubSchedule, id: 'schedule-2', vault_id: 'vault-2', cliff_date: new Date('2023-02-01'), vesting_start_date: new Date('2023-02-01'), end_timestamp: new Date('2024-02-01') }],
          },
        },
      ];
      Beneficiary.findAll.mockResolvedValue(mockBeneficiaries);

      const result = await accountConsolidationService.getConsolidatedView('BENEFICIARY_ADDRESS');

      expect(result.beneficiary_address).toBe('BENEFICIARY_ADDRESS');
      expect(result.total_vaults).toBe(2);
      expect(result.total_allocated).toBe('1000');
      expect(result.total_withdrawn).toBe('200');
      expect(result.vaults).toHaveLength(2);
      expect(result.consolidation_summary.original_vesting_tracks).toBe(2);
      expect(result.consolidation_summary.consolidated_tracks).toBe(2);
    });

    it('should return empty result for beneficiary with no vaults', async () => {
      Beneficiary.findAll.mockResolvedValue([]);

      const result = await accountConsolidationService.getConsolidatedView('UNKNOWN_ADDRESS');

      expect(result.beneficiary_address).toBe('UNKNOWN_ADDRESS');
      expect(result.total_vaults).toBe(0);
      expect(result.total_allocated).toBe('0');
      expect(result.total_withdrawn).toBe('0');
      expect(result.vaults).toHaveLength(0);
    });

    it('should filter by organization when provided', async () => {
      const mockBeneficiaries = [{ ...mockBeneficiary, vault: { ...mockVault, org_id: 'target-org', subSchedules: [mockSubSchedule] } }];
      Beneficiary.findAll.mockResolvedValue(mockBeneficiaries);

      const result = await accountConsolidationService.getConsolidatedView('BENEFICIARY_ADDRESS', { organizationId: 'target-org' });

      expect(Beneficiary.findAll).toHaveBeenCalledWith(expect.objectContaining({
        include: [expect.objectContaining({
          where: { org_id: 'target-org' },
        })],
      }));
      expect(result.total_vaults).toBe(1);
    });

    it('should skip blacklisted vaults', async () => {
      const mockBeneficiaries = [
        { ...mockBeneficiary, vault: { ...mockVault, is_blacklisted: true, subSchedules: [mockSubSchedule] } },
        { ...mockBeneficiary, id: 'beneficiary-2', vault: { ...mockVault, id: 'vault-2', is_blacklisted: false, subSchedules: [mockSubSchedule] } },
      ];
      Beneficiary.findAll.mockResolvedValue(mockBeneficiaries);

      const result = await accountConsolidationService.getConsolidatedView('BENEFICIARY_ADDRESS');

      expect(result.total_vaults).toBe(1);
      expect(result.vaults[0].vault_address).toBe('VAULT_ADDRESS_2');
    });

    it('should calculate weighted average dates correctly', async () => {
      const mockBeneficiaries = [
        {
          ...mockBeneficiary,
          total_allocated: '300',
          vault: { ...mockVault, subSchedules: [{ ...mockSubSchedule, top_up_amount: '600', cliff_date: new Date('2023-01-01'), end_timestamp: new Date('2024-01-01') }] },
        },
        {
          ...mockBeneficiary,
          id: 'beneficiary-2',
          total_allocated: '700',
          vault: { ...mockVault, id: 'vault-2', subSchedules: [{ ...mockSubSchedule, id: 'schedule-2', vault_id: 'vault-2', top_up_amount: '1400', cliff_date: new Date('2023-03-01'), end_timestamp: new Date('2024-03-01') }] },
        },
      ];
      Beneficiary.findAll.mockResolvedValue(mockBeneficiaries);

      const result = await accountConsolidationService.getConsolidatedView('BENEFICIARY_ADDRESS');

      expect(result.weighted_average_cliff_date).not.toBeNull();
      expect(result.weighted_average_end_date).not.toBeNull();
      const cliffDate = new Date(result.weighted_average_cliff_date);
      const expectedCliffDate = new Date('2023-02-12');
      expect(Math.abs(cliffDate.getTime() - expectedCliffDate.getTime())).toBeLessThan(86400000);
    });
  });

  describe('mergeBeneficiaryAddresses', () => {
    let mockTransaction;

    beforeEach(() => {
      mockTransaction = { commit: jest.fn().mockResolvedValue(), rollback: jest.fn().mockResolvedValue() };
      jest.spyOn(sequelize, 'transaction').mockResolvedValue(mockTransaction);
    });

    it('should merge beneficiary addresses successfully', async () => {
      const primaryBeneficiaries = [mockBeneficiary];
      const beneficiariesToMerge = [{ ...mockBeneficiary, id: 'beneficiary-to-merge-1', total_allocated: '200', total_withdrawn: '50', vault: mockVault }];
      Beneficiary.findAll.mockImplementation((query) => {
        if (query.where.address === 'PRIMARY_ADDRESS') return Promise.resolve(primaryBeneficiaries);
        return Promise.resolve(beneficiariesToMerge);
      });
      Beneficiary.findOne.mockResolvedValue(null);
      Beneficiary.create.mockResolvedValue({});

      const result = await accountConsolidationService.mergeBeneficiaryAddresses('PRIMARY_ADDRESS', ['ADDRESS_TO_MERGE'], 'ADMIN_ADDRESS');

      expect(result.primary_address).toBe('PRIMARY_ADDRESS');
      expect(result.merged_addresses).toContain('ADDRESS_TO_MERGE');
      expect(result.vaults_updated).toBe(1);
      expect(result.total_allocation_transferred).toBe('200');
      expect(result.total_withdrawal_transferred).toBe('50');
      expect(mockTransaction.commit).toHaveBeenCalled();
    });

    it('should merge into existing primary beneficiary record', async () => {
      const primaryBeneficiaries = [mockBeneficiary];
      const beneficiariesToMerge = [{ ...mockBeneficiary, id: 'beneficiary-to-merge-1', total_allocated: '200', total_withdrawn: '50', vault: mockVault }];
      const existingPrimary = { ...mockBeneficiary, total_allocated: '300', total_withdrawn: '100', update: jest.fn().mockResolvedValue() };
      Beneficiary.findAll.mockImplementation((query) => {
        if (query.where.address === 'PRIMARY_ADDRESS') return Promise.resolve(primaryBeneficiaries);
        return Promise.resolve(beneficiariesToMerge);
      });
      Beneficiary.findOne.mockResolvedValue(existingPrimary);

      const result = await accountConsolidationService.mergeBeneficiaryAddresses('PRIMARY_ADDRESS', ['ADDRESS_TO_MERGE'], 'ADMIN_ADDRESS');

      expect(existingPrimary.update).toHaveBeenCalledWith({ total_allocated: '500', total_withdrawn: '150' });
      expect(result.total_allocation_transferred).toBe('200');
      expect(result.total_withdrawal_transferred).toBe('50');
    });

    it('should throw error if primary address not found', async () => {
      Beneficiary.findAll.mockResolvedValue([]);

      await expect(accountConsolidationService.mergeBeneficiaryAddresses('UNKNOWN_PRIMARY', ['ADDRESS_TO_MERGE'], 'ADMIN_ADDRESS')).rejects.toThrow('Primary beneficiary address not found');
      expect(mockTransaction.rollback).toHaveBeenCalled();
    });

    it('should handle multiple addresses to merge', async () => {
      const primaryBeneficiaries = [mockBeneficiary];
      const beneficiariesToMerge = [
        { ...mockBeneficiary, id: 'beneficiary-to-merge-1', total_allocated: '200', total_withdrawn: '50', vault: mockVault },
        { ...mockBeneficiary, id: 'beneficiary-to-merge-2', total_allocated: '300', total_withdrawn: '75', vault: mockVault },
      ];
      Beneficiary.findAll.mockImplementation((query) => {
        if (query.where.address === 'PRIMARY_ADDRESS') return Promise.resolve(primaryBeneficiaries);
        return Promise.resolve(beneficiariesToMerge);
      });
      Beneficiary.findOne.mockResolvedValue(null);
      Beneficiary.create.mockResolvedValue({});

      const result = await accountConsolidationService.mergeBeneficiaryAddresses('PRIMARY_ADDRESS', ['ADDRESS_TO_MERGE_1', 'ADDRESS_TO_MERGE_2'], 'ADMIN_ADDRESS');

      expect(result.merged_addresses).toHaveLength(2);
      expect(result.total_allocation_transferred).toBe('500');
      expect(result.total_withdrawal_transferred).toBe('125');
    });
  });

  describe('_calculateVaultWeightedDates', () => {
    it('should calculate weighted average dates correctly', () => {
      const subSchedules = [
        { top_up_amount: '1000', cliff_date: new Date('2023-01-01'), end_timestamp: new Date('2024-01-01'), vesting_duration: 31536000 },
        { top_up_amount: '2000', cliff_date: new Date('2023-03-01'), end_timestamp: new Date('2024-03-01'), vesting_duration: 31622400 },
      ];

      const result = accountConsolidationService._calculateVaultWeightedDates(subSchedules, 3000);

      expect(result.cliffDate).toBeInstanceOf(Date);
      expect(result.endDate).toBeInstanceOf(Date);
      expect(result.duration).toBeGreaterThan(0);
      const expectedCliffDate = new Date('2023-02-01');
      expect(Math.abs(result.cliffDate.getTime() - expectedCliffDate.getTime())).toBeLessThan(86400000);
    });

    it('should handle empty sub-schedules', () => {
      const result = accountConsolidationService._calculateVaultWeightedDates([], 1000);
      expect(result.cliffDate).toBeNull();
      expect(result.endDate).toBeNull();
      expect(result.duration).toBe(0);
    });

    it('should handle zero allocation', () => {
      const subSchedules = [mockSubSchedule];
      const result = accountConsolidationService._calculateVaultWeightedDates(subSchedules, 0);
      expect(result.cliffDate).toBeNull();
      expect(result.endDate).toBeNull();
      expect(result.duration).toBe(0);
    });
  });
});
