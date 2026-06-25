export enum MemberStatus {
  Alive = 'Alive',
  Suspect = 'Suspect',
  Dead = 'Dead',
}

export interface Member {
  id: string;
  address: string;
  status: MemberStatus;
  incarnation: number;
  lastUpdated: number;
}

export class MemberList {
  private members: Map<string, Member> = new Map();

  addOrUpdateMember(member: Member): void {
    const existing = this.members.get(member.id);
    if (!existing) {
      this.members.set(member.id, member);
      return;
    }

    if (member.incarnation > existing.incarnation) {
      this.members.set(member.id, member);
    } else if (member.incarnation === existing.incarnation) {
      // Suspect overrides Alive, Dead overrides Suspect or Alive
      if (
        (existing.status === MemberStatus.Alive && member.status === MemberStatus.Suspect) ||
        (existing.status !== MemberStatus.Dead && member.status === MemberStatus.Dead)
      ) {
        this.members.set(member.id, member);
      }
    }
  }

  getMember(id: string): Member | undefined {
    return this.members.get(id);
  }

  getAllMembers(): Member[] {
    return Array.from(this.members.values());
  }

  getRandomPeers(count: number, excludeId?: string): Member[] {
    const pool = this.getAllMembers().filter(m => m.id !== excludeId && m.status !== MemberStatus.Dead);
    const shuffled = [...pool].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
  }
}
