declare function require(module: string): any;

const THP_ENABLED_PATH = '/sys/kernel/mm/transparent_hugepage/enabled';
const HUGEPAGE_NR_PATH = '/sys/kernel/mm/hugepages/hugepages-2048kB/nr_hugepages';

export interface HugePageInfo {
  available: boolean;
  thpEnabled: boolean;
  hugePagesConfigured: number;
  memlockUnlimited: boolean;
  regionSizeMB: number;
}

export class HugepageAllocator {
  async checkSupport(): Promise<HugePageInfo> {
    const thpEnabled = await this.readThpStatus();
    const hugePagesConfigured = await this.readHugePageCount();
    const memlockUnlimited = await this.checkMemlockRlimit();

    return {
      available: thpEnabled || hugePagesConfigured > 0,
      thpEnabled,
      hugePagesConfigured,
      memlockUnlimited,
      regionSizeMB: 32,
    };
  }

  async tryEnableHugePages(count: number = 16): Promise<boolean> {
    try {
      const fs: any = require('fs');
      if (fs.existsSync(HUGEPAGE_NR_PATH)) {
        const current = await this.readHugePageCount();
        if (current < count) {
          fs.writeFileSync(HUGEPAGE_NR_PATH, String(count), 'utf-8');
        }
        return true;
      }
    } catch (err) {
      console.warn('[hugepage-allocator] could not reserve huge pages:', (err as Error).message);
    }
    return false;
  }

  async configure(largePages: boolean = true, _lockMemory: boolean = true): Promise<HugePageInfo> {
    const info = await this.checkSupport();
    if (largePages && info.hugePagesConfigured === 0) {
      await this.tryEnableHugePages(16);
    }
    console.log('[hugepage-allocator] memory locking is handled at the native level via mlock()');
    return await this.checkSupport();
  }

  private async readThpStatus(): Promise<boolean> {
    try {
      const fs: any = require('fs');
      if (!fs.existsSync(THP_ENABLED_PATH)) return false;
      const content: string = fs.readFileSync(THP_ENABLED_PATH, 'utf-8');
      return content.includes('[always]');
    } catch {
      return false;
    }
  }

  private async readHugePageCount(): Promise<number> {
    try {
      const fs: any = require('fs');
      if (!fs.existsSync(HUGEPAGE_NR_PATH)) return 0;
      const content: string = fs.readFileSync(HUGEPAGE_NR_PATH, 'utf-8').trim();
      return parseInt(content, 10) || 0;
    } catch {
      return 0;
    }
  }

  private async checkMemlockRlimit(): Promise<boolean> {
    try {
      const fs: any = require('fs');
      const content: string = fs.readFileSync('/proc/self/limits', 'utf-8');
      const match = content.match(/max locked memory\s+(\S+)/i);
      if (match) {
        return match[1].toLowerCase() === 'unlimited';
      }
      return false;
    } catch {
      return false;
    }
  }
}

export const hugepageAllocator = new HugepageAllocator();
