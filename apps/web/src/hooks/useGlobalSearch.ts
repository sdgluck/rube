import { useEffect, useMemo, useState } from "react";
import Fuse from "fuse.js";
import { trpc } from "#/trpc";

export type SearchKind =
  | "navigation"
  | "command"
  | "collection"
  | "media"
  | "rule"
  | "job"
  | "overlayPreset"
  | "event"
  | "plexUser"
  | "plexSection";

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
  collection: "Collections",
  media: "Media",
  rule: "Rules",
  job: "Jobs",
  overlayPreset: "Overlay presets",
  event: "Events",
  plexUser: "Users",
  plexSection: "Plex sections",
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
  enabled?: boolean;
}

export function useGlobalSearch(query: string, { navigation, commands = [], enabled = true }: Options) {
  const debounced = useDebounced(query.trim(), 150);
  const hasQuery = debounced.length > 0;

  const remote = trpc.search.global.useQuery({ query: debounced }, { enabled: enabled && hasQuery, staleTime: 30_000 });

  const groups = useMemo<SearchGroup[]>(() => {
    if (!hasQuery) {
      return [{ kind: "navigation", label: KIND_LABEL.navigation, hits: navigation }];
    }

    const navFuse = new Fuse(navigation, {
      keys: ["title", "subtitle"],
      threshold: 0.4,
      ignoreLocation: true,
    });
    const navHits = navFuse.search(debounced).map((r) => r.item);

    // Commands are matched more strictly than pages. A loose match on an
    // action is worse than a loose match on a destination: arrowing onto the
    // wrong page costs a click, and arrowing onto the wrong "Run rule" starts
    // it.
    const commandFuse = new Fuse(commands, { keys: ["title", "subtitle"], threshold: 0.3, ignoreLocation: true });
    const commandHits = commandFuse.search(debounced).map((r) => r.item);

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
  }, [hasQuery, debounced, navigation, commands, remote.data]);

  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);

  return {
    groups,
    flat,
    isLoading: hasQuery && remote.isLoading,
  };
}
