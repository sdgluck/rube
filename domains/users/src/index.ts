/**
 * Users module — sync Plex users to local SQLite, query them, and manage
 * their access to the server.
 */

export { syncUsers, type SyncStats } from "./sync.ts";
export { getLocalUsers, getLocalUser, listInvites, updateUser, type LocalUser, type UserFilters } from "./query.ts";
export { getUserDetail, type UserDetail, type UserShareState } from "./detail.ts";
export {
  inviteUser,
  updateLibraries,
  updateSettings,
  updateContentRatings,
  removeUser,
  cancelInvite,
  acceptInvite,
  declineInvite,
  createManagedUser,
  addExistingUserToHome,
  removeHomeUser,
  setUserPin,
  clearUserPin,
  OwnerImmutableError,
  UnknownUserError,
  NotSharedError,
  type InviteInput,
} from "./manage.ts";
