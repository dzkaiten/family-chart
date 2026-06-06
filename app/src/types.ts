import type { LanguageCode } from './config';

export interface NameEntry {
  first?: string;
  last?: string;
  // A single-unit name (e.g. a Chinese name written surname+given with no
  // separator). When present, it is the canonical form for that script and
  // `first`/`last` are ignored for display.
  full?: string;
}

export type NamesMap = Partial<Record<LanguageCode, NameEntry>> & {
  [code: string]: NameEntry | undefined;
};

export interface PersonData {
  names: NamesMap;
  gender?: 'M' | 'F' | string;
  birthday?: string;
  avatar?: string; // storage path (e.g. "{tree_id}/{person_id}/file.jpg"), not a URL
  [key: string]: unknown;
}

export interface PersonRels {
  parents: string[];
  spouses: string[];
  children: string[];
  [key: string]: unknown;
}

// Persisted shape stored in tree_data.data
export interface StoredPerson {
  id: string;
  data: PersonData;
  rels: PersonRels;
}

// Library-facing shape: flat name fields, signed avatar URL
export interface DisplayPerson {
  id: string;
  data: {
    first_name?: string;
    last_name?: string;
    gender?: string;
    birthday?: string;
    avatar?: string; // signed URL ready for <img>
    [key: string]: unknown;
  };
  rels: PersonRels;
}

export interface TreeDataRow {
  id: string;
  tree_id: string;
  data: StoredPerson[];
  version: number;
  data_version: number;
  updated_at: string;
  updated_by: string | null;
}

export interface AccessRequest {
  id: string;
  tree_id: string;
  name: string;
  email: string;
  status: 'pending' | 'approved' | 'denied';
  requested_role: string;
  requested_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface AllowedEmail {
  id: string;
  tree_id: string;
  email: string;
  role: 'owner' | 'editor';
  created_at: string;
}

export interface TreeMeta {
  id: string;
  name: string;
  default_language: string;
}

export type Session = {
  email: string;
  role: 'owner' | 'editor' | null; // null if signed in but not allowlisted
};
