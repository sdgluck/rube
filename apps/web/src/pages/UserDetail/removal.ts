/**
 * The two ways to take someone off the server, in the words the confirm uses.
 *
 * One place because Users and the user page both offer "Remove access", and
 * the two copies had already started to drift — a confirm that says different
 * things about the same irreversible act on two screens is worse than either.
 */
export type RemovalMode = "unshare" | "unfriend";

export function removalCopy(mode: RemovalMode, username: string) {
  return mode === "unshare"
    ? {
        title: "Remove access?",
        message: `${username} loses access to this server, and their personal collections are deleted.`,
        confirmLabel: "Remove access",
      }
    : {
        title: "Remove friend?",
        message: `${username} is removed as a Plex friend, along with every server you share with them.`,
        confirmLabel: "Remove friend",
      };
}
