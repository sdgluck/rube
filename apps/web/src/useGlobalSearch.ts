import { useEffect, useMemo, useState } from "react";
import Fuse from "fuse.js";
import { trpc } from "./trpc";

export type SearchKind =
  | "navigation"
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
  href: string;
}

export interface SearchGroup {
  kind: SearchKind;
  label: string;
  hits: SearchHit[];
}

const KIND_LABEL: Record<SearchKind, string> = {
  navigation: "Navigation",
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
  enabled?: boolean;
}

export function useGlobalSearch(query: string, { navigation, enabled = true }: Options) {
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

    const all: SearchHit[] = [...navHits, ...(remote.data?.hits ?? [])];
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
  }, [hasQuery, debounced, navigation, remote.data]);

  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);

  return {
    groups,
    flat,
    isLoading: hasQuery && remote.isLoading,
  };
}
