import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient, BASE_URL } from './api';

const MEM_TTL_MS = 10 * 60 * 1000;      
const DISK_TTL_MS = 24 * 60 * 60 * 1000; 
const DISK_PREFIX = '@dp_cache:';
const BATCH_WINDOW_MS = 40;              
const MAX_BATCH = 50;

export interface CachedProfile {
  username: string;
  avatarUrl: string | null;
  fetchedAt: number;
}

const memory = new Map<string, CachedProfile>();
const inFlight = new Map<string, Promise<CachedProfile | null>>();

let pendingBatch = new Set<string>();
let batchTimer: any = null;
let batchWaiters: Array<() => void> = [];

const norm = (u: string) => (u || '').trim().toLowerCase();

export const toAbsoluteUrl = (raw: string | null | undefined): string | null => {
  if (!raw || typeof raw !== 'string' || !raw.trim()) return null;
  const v = raw.trim();
  if (v.startsWith('http') || v.startsWith('data:') || v.startsWith('file://')) return v;
  return `${BASE_URL}${v.startsWith('/') ? '' : '/'}${v}`;
};

const readDisk = async (username: string): Promise<CachedProfile | null> => {
  try {
    const raw = await AsyncStorage.getItem(DISK_PREFIX + username);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedProfile;
    if (!parsed || typeof parsed.fetchedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeDisk = async (profile: CachedProfile) => {
  try {
    await AsyncStorage.setItem(DISK_PREFIX + profile.username, JSON.stringify(profile));
  } catch { }
};

const fetchBatch = async (usernames: string[]): Promise<CachedProfile[]> => {
  const now = Date.now();
  if (!usernames.length) return [];

  try {
    const res: any = await apiClient.post('/v1/social/user/profiles/batch', { usernames });
    const list = Array.isArray(res) ? res : res?.profiles || res?.users || [];
    if (Array.isArray(list) && list.length) {
      return list.map((p: any) => ({
        username: norm(p.username),
        avatarUrl: p.avatarUrl || p.profilePictureUrl || null,
        fetchedAt: now,
      }));
    }
  } catch { }

  const out: CachedProfile[] = [];
  for (const u of usernames.slice(0, MAX_BATCH)) {
    try {
      const p: any = await apiClient.get(`/v1/social/user/${encodeURIComponent(u)}/profile`);
      out.push({
        username: u,
        avatarUrl: p?.avatarUrl || p?.profilePictureUrl || p?.data?.avatarUrl || null,
        fetchedAt: now,
      });
    } catch {
      out.push({ username: u, avatarUrl: null, fetchedAt: now });
    }
  }
  return out;
};

const flushBatch = async () => {
  const names = Array.from(pendingBatch);
  pendingBatch = new Set();
  batchTimer = null;

  const waiters = batchWaiters;
  batchWaiters = [];

  if (names.length) {
    const results = await fetchBatch(names);
    for (const p of results) {
      memory.set(p.username, p);
      writeDisk(p);
    }
    const returned = new Set(results.map((r) => r.username));
    for (const n of names) {
      if (!returned.has(n)) {
        const miss = { username: n, avatarUrl: null, fetchedAt: Date.now() };
        memory.set(n, miss);
      }
    }
  }

  waiters.forEach((w) => w());
};

const queue = (username: string): Promise<void> => {
  pendingBatch.add(username);
  return new Promise((resolve) => {
    batchWaiters.push(resolve);
    if (!batchTimer) batchTimer = setTimeout(flushBatch, BATCH_WINDOW_MS);
  });
};

export const getAvatarUrl = async (usernameRaw: string): Promise<string | null> => {
  const username = norm(usernameRaw);
  if (!username) return null;

  const mem = memory.get(username);
  if (mem && Date.now() - mem.fetchedAt < MEM_TTL_MS) {
    return toAbsoluteUrl(mem.avatarUrl);
  }

  if (!mem) {
    const disk = await readDisk(username);
    if (disk) {
      memory.set(username, disk);
      if (Date.now() - disk.fetchedAt < DISK_TTL_MS) {
        if (Date.now() - disk.fetchedAt > MEM_TTL_MS) queue(username);
        return toAbsoluteUrl(disk.avatarUrl);
      }
    }
  }

  const existing = inFlight.get(username);
  if (existing) {
    await existing;
    return toAbsoluteUrl(memory.get(username)?.avatarUrl ?? null);
  }

  const p = queue(username).then(() => memory.get(username) ?? null);
  inFlight.set(username, p as Promise<CachedProfile | null>);
  try {
    await p;
  } finally {
    inFlight.delete(username);
  }

  return toAbsoluteUrl(memory.get(username)?.avatarUrl ?? null);
};

export const preloadAvatars = async (usernames: string[]): Promise<void> => {
  const need = Array.from(new Set(usernames.map(norm).filter(Boolean))).filter((u) => {
    const m = memory.get(u);
    return !m || Date.now() - m.fetchedAt > MEM_TTL_MS;
  });
  if (!need.length) return;
  for (const u of need) pendingBatch.add(u);
  if (!batchTimer) batchTimer = setTimeout(flushBatch, BATCH_WINDOW_MS);
  await new Promise<void>((resolve) => batchWaiters.push(resolve));
};

export const peekAvatarUrl = (usernameRaw: string): string | null => {
  const m = memory.get(norm(usernameRaw));
  return m ? toAbsoluteUrl(m.avatarUrl) : null;
};

export const invalidateAvatar = async (usernameRaw: string) => {
  const username = norm(usernameRaw);
  memory.delete(username);
  try {
    await AsyncStorage.removeItem(DISK_PREFIX + username);
  } catch { }
};

export const clearAvatarCache = async () => {
  memory.clear();
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith(DISK_PREFIX));
    if (mine.length) await AsyncStorage.multiRemove(mine);
  } catch { }
};