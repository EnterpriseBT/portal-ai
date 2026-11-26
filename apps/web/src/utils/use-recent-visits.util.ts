import {
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";

import {
  SEARCH_MAX_REFS,
  type SearchResultType,
} from "@portalai/core/contracts";

import { sdk } from "../api/sdk";
import { AuthContext } from "../providers/Auth.provider";

/**
 * #1076: the palette's Recent, kept in this browser. Ids only, never names:
 * the palette hydrates them through `GET /api/search?refs=`, so a deleted,
 * unshared or other-org object drops out and is pruned. Portals aren't kept
 * here; their recency is the server's `lastOpened`.
 */
export interface RecentVisit {
  type: Exclude<SearchResultType, "portal">;
  id: string;
  visitedAt: number;
}

export const RECENT_VISITS_MAX = SEARCH_MAX_REFS;

const RECENT_TYPES = new Set<string>([
  "station",
  "pin",
  "curated_view",
  "connector_instance",
  "entity",
]);

export function recentVisitsKey(organizationId: string, userSub: string) {
  return `portalai-recent:${organizationId}:${userSub}`;
}

/** Adds a visit: newest first, one entry per object, at most 20. */
export function recordVisit(
  list: RecentVisit[],
  visit: RecentVisit
): RecentVisit[] {
  return [
    visit,
    ...list.filter((v) => !(v.type === visit.type && v.id === visit.id)),
  ].slice(0, RECENT_VISITS_MAX);
}

/** Keeps the visits whose `type:id` the server still returned. */
export function pruneVisits(
  list: RecentVisit[],
  readable: Set<string>
): RecentVisit[] {
  return list.filter((v) => readable.has(`${v.type}:${v.id}`));
}

const isVisit = (value: unknown): value is RecentVisit => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.type === "string" &&
    RECENT_TYPES.has(v.type) &&
    typeof v.id === "string" &&
    v.id.length > 0 &&
    typeof v.visitedAt === "number"
  );
};

// Every storage access is guarded: a private window or blocked site data can
// make the accessor itself throw. Failure reads as no visits.
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const EMPTY: RecentVisit[] = [];
const snapshots = new Map<
  string,
  { raw: string | null; value: RecentVisit[] }
>();
const listeners = new Set<() => void>();

function readRaw(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function readVisits(key: string): RecentVisit[] {
  const raw = readRaw(key);
  const cached = snapshots.get(key);
  if (cached && cached.raw === raw) return cached.value;
  let value = EMPTY;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    // Capped on read too: a hand-edited store past the cap would otherwise
    // send more refs than search accepts, and a refused hydration never
    // prunes, so Recent would stay hidden (#1076 adversarial review).
    if (Array.isArray(parsed)) {
      value = parsed.filter(isVisit).slice(0, RECENT_VISITS_MAX);
    }
  } catch {
    value = EMPTY;
  }
  snapshots.set(key, { raw, value });
  return value;
}

function writeVisits(key: string, list: RecentVisit[]): void {
  try {
    storage()?.setItem(key, JSON.stringify(list));
  } catch {
    // Storage full or blocked: Recent just doesn't remember.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** The signed-in user's Auth0 `sub`, or undefined. */
function useUserSub(): string | undefined {
  const auth = useContext(AuthContext);
  return (auth?.session.user as { sub?: string } | undefined)?.sub;
}

function useVisitsFor(organizationId: string | undefined): {
  visits: RecentVisit[];
  record: (visit: Omit<RecentVisit, "visitedAt">) => void;
  prune: (readable: Set<string>) => void;
} {
  const sub = useUserSub();
  const key =
    organizationId && sub ? recentVisitsKey(organizationId, sub) : null;
  const visits = useSyncExternalStore(
    subscribe,
    () => (key ? readVisits(key) : EMPTY),
    () => EMPTY
  );
  const record = useCallback(
    (visit: Omit<RecentVisit, "visitedAt">) => {
      if (!key) return;
      writeVisits(
        key,
        recordVisit(readVisits(key), { ...visit, visitedAt: Date.now() })
      );
    },
    [key]
  );
  const prune = useCallback(
    (readable: Set<string>) => {
      if (!key) return;
      const current = readVisits(key);
      const next = pruneVisits(current, readable);
      if (next.length !== current.length) writeVisits(key, next);
    },
    [key]
  );
  return { visits, record, prune };
}

/** The palette's Recent for the active org; empty until the org and user are known. */
export function useRecentVisits() {
  const { data } = sdk.organizations.current();
  return useVisitsFor(data?.organization.id);
}

/**
 * Records a detail page's object once it has loaded, under the object's own
 * org (a 404 has no object, so it never records).
 */
export function useRecordRecentVisit(
  type: RecentVisit["type"],
  object: { id: string; organizationId: string } | null | undefined
): void {
  const { record } = useVisitsFor(object?.organizationId);
  const id = object?.id;
  useEffect(() => {
    if (id) record({ type, id });
  }, [type, id, record]);
}
