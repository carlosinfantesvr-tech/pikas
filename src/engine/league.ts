export interface LeagueMemberStat {
  userId: string;
  username: string;
  equity: number | null;
  initial: number | null;
}

export function rankLeague(members: LeagueMemberStat[]) {
  return members
    .map((member) => {
      const has = member.equity != null && member.initial != null && member.initial > 0;
      const returnPct = has ? (member.equity! - member.initial!) / member.initial! : null;
      return { ...member, returnPct };
    })
    .sort((a, b) => (b.returnPct ?? -999) - (a.returnPct ?? -999));
}
