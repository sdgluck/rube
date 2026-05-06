export interface JobGroupMember {
  id: string;
  /**
   * If true, running this member only makes sense while the primary is enabled —
   * the page will gate "Run Now" and surface a warning when the primary is off.
   * Members where the action is still useful when the primary is disabled
   * (e.g. clearing/undoing) should set this to false.
   */
  requiresPrimary: boolean;
  /** Short summary used inline next to "Linked to {primary}". */
  summary: string;
}

export interface JobGroup {
  /** Job id of the primary that owns the cluster. */
  primary: string;
  /** Display name used in cross-links and notices. */
  primaryName: string;
  members: JobGroupMember[];
}

export const JOB_GROUPS: JobGroup[] = [
  {
    primary: "because-you-watched",
    primaryName: "Because You Watched",
    members: [
      {
        id: "label",
        requiresPrimary: true,
        summary: "Labels Plex items and configures the per-user sharing restrictions Because You Watched relies on.",
      },
      {
        id: "label-undo",
        requiresPrimary: false,
        summary: "Removes the labels and per-user restrictions previously applied.",
      },
    ],
  },
];

export function getGroupForPrimary(primaryId: string): JobGroup | undefined {
  return JOB_GROUPS.find((g) => g.primary === primaryId);
}

export function getGroupForMember(memberId: string): { group: JobGroup; member: JobGroupMember } | undefined {
  for (const group of JOB_GROUPS) {
    const member = group.members.find((m) => m.id === memberId);
    if (member) return { group, member };
  }
  return undefined;
}

export function isGroupPrimary(jobId: string): boolean {
  return JOB_GROUPS.some((g) => g.primary === jobId);
}

export function getMembersOf(primaryId: string): JobGroupMember[] {
  return getGroupForPrimary(primaryId)?.members ?? [];
}
