import { useEffect, useMemo, useState } from "react";
import Fuse from "fuse.js";
import { trpc } from "#/trpc";
import { parseQuery, type SearchKind } from "#/lib/searchScopes";

export type { SearchKind };

/** The kinds the server can return — everything except the locally-built ones. */
export type RemoteSearchKind = Exclude<SearchKind, "navigation" | "command" | "recent">;

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle?: string;
  /** Where selecting this goes. Empty for a command, which does something. */
  href: string;
  /**
   * What selecting this *does*, for hits that are actions rather than places.
   *
   * The palette was navigation-only: it already indexed every rule and job by
   * name, and the one thing you could do with the rule you had just found was
   * look at it. A hit with a `run` is invoked in place instead of navigated to.
   */
  run?: () => void;
}

export interface SearchGroup {
  kind: SearchKind;
  label: string;
  hits: SearchHit[];
}

const KIND_LABEL: Record<SearchKind, string> = {
  navigation: "Navigation",
  command: "Actions",
  recent: "Recent",
  collection: "Collections",
  media: "Media",
  rule: "Rules",
  job: "Jobs",
  overlayPreset: "Overlay presets",
  event: "Events",
  plexUser: "Users",
  plexSection: "Plex sections",
  preroll: "Prerolls",
};

const KIND_ORDER: SearchKind[] = [
  // Actions first once something is typed: someone who types "run nightly"
  // wants the verb, and burying it under the pages that also match the word
  // is how a palette gets a reputation for not having the thing you wanted.
  "command",
  "navigation",
  "collection",
  "media",
  "rule",
  "job",
  "overlayPreset",
  "preroll",
  "plexSection",
  "plexUser",
  "event",
];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

interface Options {
  navigation: SearchHit[];
  /** Actions the palette can perform. Matched locally, like navigation. */
  commands?: SearchHit[];
  /** Previously-selected destinations, shown on an empty query. */
  recents?: SearchHit[];
  enabled?: boolean;
}

export function useGlobalSearch(query: string, { navigation, commands = [], recents = [], enabled = true }: Options) {
  const parsed = useMemo(() => parseQuery(query), [query]);
  const debounced = useDebounced(parsed.text.trim(), 150);
  const scopeKinds = parsed.scope?.kinds;
  const hasQuery = debounced.length > 0;

  // Kinds the server knows about, or undefined for "everything". A scope of
  // command/navigation alone means there is nothing to ask the server for.
  const remoteKinds = useMemo(
    () => scopeKinds?.filter((k): k is RemoteSearchKind => k !== "command" && k !== "navigation" && k !== "recent"),
    [scopeKinds],
  );
  const wantsRemote = !scopeKinds || (remoteKinds?.length ?? 0) > 0;

  const remote = trpc.search.global.useQuery(
    { query: debounced, kinds: remoteKinds?.length ? remoteKinds : undefined },
    { enabled: enabled && hasQuery && wantsRemote, staleTime: 30_000 },
  );

  const groups = useMemo<SearchGroup[]>(() => {
    const inScope = (kind: SearchKind) => !scopeKinds || scopeKinds.includes(kind);

    if (!hasQuery) {
      // The resting state. Recents lead: the palette's most common use is
      // going back to the thing you were just looking at.
      return [
        ...(recents.length > 0 && inScope("recent")
          ? [{ kind: "recent" as const, label: KIND_LABEL.recent, hits: recents }]
          : []),
        ...(inScope("navigation")
          ? [{ kind: "navigation" as const, label: KIND_LABEL.navigation, hits: navigation }]
          : []),
        ...(inScope("command") && commands.length > 0
          ? [{ kind: "command" as const, label: KIND_LABEL.command, hits: commands.slice(0, 8) }]
          : []),
      ];
    }

    const navHits = inScope("navigation")
      ? new Fuse(navigation, { keys: ["title", "subtitle"], threshold: 0.4, ignoreLocation: true })
          .search(debounced)
          .map((r) => r.item)
      : [];

    // Commands are matched more strictly than pages. A loose match on an
    // action is worse than a loose match on a destination: arrowing onto the
    // wrong page costs a click, and arrowing onto the wrong "Run rule" starts
    // it.
    const commandHits = inScope("command")
      ? new Fuse(commands, { keys: ["title", "subtitle"], threshold: 0.3, ignoreLocation: true })
          .search(debounced)
          .map((r) => r.item)
      : [];

    const all: SearchHit[] = [...commandHits, ...navHits, ...(remote.data?.hits ?? [])];
    const byKind = new Map<SearchKind, SearchHit[]>();
    for (const hit of all) {
      const arr = byKind.get(hit.kind) ?? [];
      arr.push(hit);
      byKind.set(hit.kind, arr);
    }

    return KIND_ORDER.flatMap<SearchGroup>((kind) => {
      const hits = byKind.get(kind);
      return hits && hits.length > 0 ? [{ kind, label: KIND_LABEL[kind], hits }] : [];
    });
  }, [hasQuery, debounced, navigation, commands, recents, remote.data, scopeKinds]);

  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);

  return {
    groups,
    flat,
    scope: parsed.scope,
    isLoading: hasQuery && wantsRemote && remote.isLoading,
  };
}
