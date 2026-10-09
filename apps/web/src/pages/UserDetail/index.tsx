import { useState, Fragment } from "react";
import { useParams, useNavigate, useLocation, Navigate, Outlet } from "react-router-dom";
import { KeyRound, Trash2, UserMinus } from "lucide-react";
import { trpc } from "#/trpc";
import ConfirmModal from "#components/ConfirmModal";
import { DetailSkeleton } from "#components/Skeleton";
import FadeImage from "#components/FadeImage";
import PageTabs from "#components/PageTabs";
import RelativeTime from "#components/RelativeTime";
import RowActions, { type RowAction } from "#components/RowActions";
import { useToast } from "#components/Toast";
import { PageCrumbs } from "#layout/AppBar";
import styles from "#/styles/shared.module.css";
import { UserProvider } from "./context.ts";
import { removalCopy, type RemovalMode } from "./removal.ts";
import local from "./UserDetail.module.css";

export default function UserDetailLayout() {
  const { userId: userIdParam } = useParams<{ userId: string }>();
  const userId = Number(userIdParam);
  const navigate = useNavigate();
  const location = useLocation();
  const utils = trpc.useUtils();
  const { addToast } = useToast();

  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);

  const enabled = Number.isFinite(userId);
  const query = trpc.users.get.useQuery({ userId }, { enabled, refetchOnWindowFocus: false });

  const removeMutation = trpc.users.remove.useMutation();
  const clearPinMutation = trpc.users.clearPin.useMutation();

  const refresh = () => {
    utils.users.get.invalidate({ userId });
    utils.users.list.invalidate();
  };

  if (query.isLoading) return <DetailSkeleton />;
  if (query.error || !query.data) {
    return <div className={`${styles.toast} ${styles.error}`}>User not found</div>;
  }

  const detail = query.data;
  const { user, share } = detail;
  const base = `/users/${userId}`;

  const confirmRemoval = (mode: RemovalMode) => {
    setPendingConfirm({
      ...removalCopy(mode, user.username),
      onConfirm: async () => {
        setPendingConfirm(null);
        try {
          await removeMutation.mutateAsync({ userId, mode });
          utils.users.list.invalidate();
          addToast(mode === "unshare" ? "Access removed" : "Friend removed", "success");
          navigate("/users");
        } catch (err) {
          addToast(err instanceof Error ? err.message : "Failed to remove the user", "error");
        }
      },
    });
  };

  // The owner is the account the server belongs to. Plex refuses every one of
  // these against it, so they are absent rather than present-and-failing.
  const actions: RowAction[] = user.isOwner
    ? []
    : [
        ...(user.isProtected
          ? [
              {
                label: "Clear PIN",
                icon: KeyRound,
                onSelect: async () => {
                  try {
                    await clearPinMutation.mutateAsync({ userId });
                    refresh();
                    addToast("PIN cleared", "success");
                  } catch (err) {
                    addToast(err instanceof Error ? err.message : "Failed to clear the PIN", "error");
                  }
                },
              },
            ]
          : []),
        ...(share ? [{ label: "Remove access", icon: UserMinus, onSelect: () => confirmRemoval("unshare") }] : []),
        { label: "Remove friend", icon: Trash2, onSelect: () => confirmRemoval("unfriend"), danger: true },
      ];

  // "0 collections" reads as "this user sees nothing", which isn't what the
  // number means: it only counts collections labelled `User:<name>`, i.e. the
  // ones personalization generated for them. When it is zero because they
  // never opted in, the pill says why instead of a bare 0.
  const personalizationOff = user.collectionCount === 0 && !user.optedIn;

  // Plex refuses every share setting on the owner, and a Home user has no
  // share to set — so for them the Access tab is absent, not an empty page.
  const hasAccessTab = !user.isOwner && !!share;

  const chips = [
    user.isOwner && "Owner",
    user.isManaged ? "Managed" : user.isHome && "Home",
    user.isProtected && "PIN",
    !user.accepted && "Invite pending",
    user.optedIn && "Personalized",
  ].filter(Boolean) as string[];

  return (
    <div>
      <PageCrumbs crumbs={[{ label: user.name || user.username }]} />

      <header className={local.hero}>
        <div className={local.avatarFrame}>
          {user.thumb ? (
            <FadeImage className={local.avatarImg} src={user.thumb} alt="" />
          ) : (
            <div className={local.avatarEmpty} aria-hidden="true">
              {user.username.slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>

        <div className={local.heroMain}>
          <div className={local.heroTop}>
            <div className={local.heroIdentity}>
              <div className={local.eyebrow}>{user.email || "No email on file"}</div>
              <h2 className={local.heroTitle}>{user.name || user.username}</h2>
            </div>
            {actions.length > 0 && (
              <div className={local.heroActions}>
                <RowActions actions={actions} label="User actions" />
              </div>
            )}
          </div>

          <div className={local.metaLine}>
            <span title="Server-wide collections aren't counted">
              {personalizationOff ? (
                <>
                  <strong className={local.metaNum}>—</strong> personal collections{" "}
                  <span className={styles.metaChip}>opted out</span>
                </>
              ) : (
                <>
                  <strong className={local.metaNum}>{user.collectionCount}</strong> personal collection
                  {user.collectionCount === 1 ? "" : "s"}
                </>
              )}
            </span>
            <span className={local.metaDot}>·</span>
            <span>
              {share
                ? share.librarySectionIds.length === 0
                  ? "all libraries"
                  : `${share.librarySectionIds.length} librar${share.librarySectionIds.length === 1 ? "y" : "ies"}`
                : "no share on this server"}
            </span>
            {user.lastWatchedAt && (
              <>
                <span className={local.metaDot}>·</span>
                <span>
                  last watched <RelativeTime timestamp={user.lastWatchedAt} seconds />
                </span>
              </>
            )}
            {chips.length > 0 && (
              <>
                <span className={local.metaRule} aria-hidden="true" />
                <span className={local.chipGroup}>
                  {chips.map((chip) => (
                    <span key={chip} className={styles.metaChip}>
                      {chip}
                    </span>
                  ))}
                </span>
              </>
            )}
          </div>
        </div>
      </header>

      <div className={local.tabsRow}>
        <PageTabs
          tabs={[
            ...(hasAccessTab ? [{ to: base, label: "Access" }] : []),
            { to: `${base}/activity`, label: "Activity" },
            { to: `${base}/sessions`, label: "Sessions" },
          ]}
          ariaLabel="User sections"
        />
      </div>

      <UserProvider value={{ userId, detail, refresh }}>
        {/* Keyed on the path so a tab switch remounts rather than carrying the
            previous tab's local state into a different view. */}
        <Fragment key={location.pathname}>
          {/* The index route is Access; a deep link to it for a user without
              one lands on the first tab they do have. */}
          {!hasAccessTab && location.pathname.replace(/\/$/, "") === base ? (
            <Navigate to={`${base}/activity`} replace />
          ) : (
            <Outlet />
          )}
        </Fragment>
      </UserProvider>

      {pendingConfirm && (
        <ConfirmModal
          title={pendingConfirm.title}
          message={pendingConfirm.message}
          confirmLabel={pendingConfirm.confirmLabel}
          danger
          onConfirm={pendingConfirm.onConfirm}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </div>
  );
}
