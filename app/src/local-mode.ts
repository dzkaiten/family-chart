import type { Session, StoredPerson, TreeDataRow, TreeMeta } from './types';

export class StaleVersionError extends Error {
  constructor() {
    super('Tree was updated by someone else. Refresh and try again.');
    this.name = 'StaleVersionError';
  }
}

// In dev builds only, ?local=true in the URL enables local mode.
// import.meta.env.DEV is false in production builds, so this is fully tree-shaken out.
const devOverride = import.meta.env.DEV &&
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).get('local') === 'true';

export const LOCAL_MODE = import.meta.env.VITE_LOCAL_MODE === 'true' || devOverride;

export const LOCAL_SESSION: Session = { email: 'dev@local', role: 'owner' };

export const LOCAL_TREE_META: TreeMeta = {
  id: 'local',
  name: 'Local Tree',
  default_language: 'en'
};

const STORAGE_DATA_KEY = 'local_tree_data';
const STORAGE_VERSION_KEY = 'local_tree_version';

export function localGetTreeData(): TreeDataRow | null {
  const raw = localStorage.getItem(STORAGE_DATA_KEY);
  // Start a brand-new local tree as EMPTY (not null), so the app boots straight
  // into the "add your first person" flow instead of throwing "Tree data not
  // found" on the very first ?local=true visit.
  const data = raw ? (JSON.parse(raw) as StoredPerson[]) : [];
  const version = parseInt(localStorage.getItem(STORAGE_VERSION_KEY) ?? '1', 10);
  return {
    id: 'local',
    tree_id: 'local',
    data,
    version,
    data_version: 1,
    updated_at: new Date().toISOString(),
    updated_by: null
  };
}

export function localSaveTreeData(
  people: StoredPerson[],
  expectedVersion: number
): TreeDataRow {
  const current = parseInt(localStorage.getItem(STORAGE_VERSION_KEY) ?? '1', 10);
  if (current !== expectedVersion) throw new StaleVersionError();
  const newVersion = expectedVersion + 1;
  localStorage.setItem(STORAGE_DATA_KEY, JSON.stringify(people));
  localStorage.setItem(STORAGE_VERSION_KEY, String(newVersion));
  return {
    id: 'local',
    tree_id: 'local',
    data: people,
    version: newVersion,
    data_version: 1,
    updated_at: new Date().toISOString(),
    updated_by: null
  };
}
