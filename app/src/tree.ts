import f3 from '../../src/index';
import { fetchTreeData, saveTreeData, StaleVersionError } from './db';
import {
  buildFormFields,
  getLanguage,
  mergePersonUpdate,
  toDisplayPeople
} from './lang';
import {
  pruneOrphanedAvatars,
  resolveAvatarUrls,
  uploadAvatar
} from './storage';
import { showToast } from './ui';
import type { DisplayPerson, StoredPerson, TreeDataRow } from './types';

interface TreeState {
  row: TreeDataRow;
  avatarPaths: Map<string, string>; // person id -> last known storage path
  chart: any;
  container: HTMLElement;
  canEdit: boolean;
}

let state: TreeState | null = null;
let saveInFlight: Promise<void> | null = null;

function buildAvatarMap(people: StoredPerson[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of people) {
    const a = p.data.avatar;
    if (typeof a === 'string' && a) m.set(p.id, a);
  }
  return m;
}

export async function initTree(container: HTMLElement, canEdit: boolean): Promise<void> {
  const row = await fetchTreeData();
  if (!row) throw new Error('Tree data not found. Run the seed INSERT in supabase/schema.sql setup.');
  state = {
    row,
    avatarPaths: buildAvatarMap(row.data),
    chart: null,
    container,
    canEdit
  };
  await render();
}

export async function refreshTree(): Promise<void> {
  if (!state) return;
  const row = await fetchTreeData();
  if (!row) return;
  state.row = row;
  state.avatarPaths = buildAvatarMap(row.data);
  await render();
}

export async function rerenderForLanguage(): Promise<void> {
  await render();
}

async function render(): Promise<void> {
  if (!state) return;
  state.container.innerHTML = '<div id="tree-container" class="tree-root"></div>';
  const treeEl = state.container.querySelector('#tree-container') as HTMLElement;

  // Seed an empty starter datum if the tree has no people yet, so the user
  // sees a usable starting point.
  const sourcePeople = state.row.data.length > 0 ? state.row.data : seedFirstPerson();
  const display = toDisplayPeople(sourcePeople);
  const withSigned = await resolveAvatarUrls(display);

  const f3Chart = (f3 as any).createChart(treeEl, withSigned)
    .setTransitionTime(800)
    .setCardXSpacing(250)
    .setCardYSpacing(150);

  const f3Card = f3Chart.setCard((f3 as any).CardHtml)
    .setCardDisplay([['first_name', 'last_name'], ['birthday']])
    .setMiniTree(true);

  if (state.canEdit) {
    const fields = buildFormFields().map(f => f.name);
    f3Chart.editTree()
      .setFields(fields)
      .setEditFirst(true)
      .setCardClickOpen(f3Card)
      .setOnChange(() => {
        scheduleSave();
      });
    // Inject a photo upload button into the form when it opens
    installPhotoUploadHook(state.container);
  } else {
    f3Card.setOnCardClick((_e: any, d: any) => f3Chart.updateMainId(d.data.id));
  }

  state.chart = f3Chart;
  f3Chart.updateTree({ initial: true });
}

function seedFirstPerson(): StoredPerson[] {
  return [{
    id: crypto.randomUUID(),
    data: { names: {} },
    rels: { parents: [], spouses: [], children: [] }
  }];
}

function scheduleSave(): void {
  // Coalesce rapid changes: chain after any in-flight save.
  saveInFlight = (saveInFlight ?? Promise.resolve()).then(() => persistCurrent());
}

async function persistCurrent(): Promise<void> {
  if (!state || !state.chart) return;
  const libData = state.chart.getStore().getData() as DisplayPerson[];
  const beforePeople = state.row.data;
  const stored: StoredPerson[] = libData.map(d => displayToStored(d));

  try {
    const updated = await saveTreeData(stored, state.row.version);
    state.row = updated;
    state.avatarPaths = buildAvatarMap(updated.data);
    // Clean up any avatar files that are no longer referenced
    pruneOrphanedAvatars(beforePeople, updated.data).catch(() => undefined);
  } catch (err) {
    if (err instanceof StaleVersionError) {
      showToast('Someone else updated the tree. Refreshing…', 'error');
      await refreshTree();
    } else {
      console.error('Save failed', err);
      showToast(`Save failed: ${(err as Error).message}`, 'error');
    }
  }
}

function displayToStored(d: DisplayPerson): StoredPerson {
  if (!state) throw new Error('Tree state not initialized');
  const original = state.row.data.find(p => p.id === d.id) ?? null;

  // Resolve avatar path. The library was shown a signed URL; if it's still
  // there unchanged we restore the original path. If the field now contains a
  // bare path (newly uploaded) we use that. If it's empty, clear.
  const a = d.data.avatar;
  let avatarPath: string | undefined;
  if (typeof a !== 'string' || a === '') {
    avatarPath = undefined;
  } else if (a.startsWith('http://') || a.startsWith('https://')) {
    avatarPath = state.avatarPaths.get(d.id);
  } else {
    avatarPath = a;
  }

  const newData = mergePersonUpdate(original, d.data, getLanguage());
  if (avatarPath) newData.avatar = avatarPath;
  else delete (newData as Record<string, unknown>).avatar;

  return {
    id: d.id,
    data: newData,
    rels: {
      parents: Array.isArray(d.rels?.parents) ? (d.rels.parents as string[]) : [],
      spouses: Array.isArray(d.rels?.spouses) ? (d.rels.spouses as string[]) : [],
      children: Array.isArray(d.rels?.children) ? (d.rels.children as string[]) : []
    }
  };
}

// ---------------------------------------------------------------------------
// Photo upload: inject a file input into the edit form when it appears
// ---------------------------------------------------------------------------

function installPhotoUploadHook(root: HTMLElement): void {
  const observer = new MutationObserver(() => {
    const form = root.querySelector('form');
    if (!form) return;
    if (form.querySelector('[data-photo-upload]')) return;

    const personId = readPersonIdFromForm(form);
    if (!personId) return;

    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-photo-upload', '');
    wrapper.style.margin = '10px 0';
    wrapper.innerHTML = `
      <label class="muted" style="display:block;margin-bottom:6px;">Profile photo</label>
      <input type="file" accept="image/*" />
    `;
    const input = wrapper.querySelector('input') as HTMLInputElement;
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const path = await uploadAvatar(personId, file);
        // Set the avatar text field so the library notices the change
        const avatarInput = form.querySelector<HTMLInputElement>('[name="avatar"], [id="avatar"]');
        if (avatarInput) {
          avatarInput.value = path;
          avatarInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        showToast('Photo uploaded. Save the form to apply.');
      } catch (err) {
        console.error(err);
        showToast(`Upload failed: ${(err as Error).message}`, 'error');
      }
    });

    // Place the upload control just above the submit button if found
    const submit = form.querySelector('button[type="submit"], input[type="submit"]');
    if (submit?.parentElement) submit.parentElement.insertBefore(wrapper, submit);
    else form.appendChild(wrapper);
  });
  observer.observe(root, { childList: true, subtree: true });
}

function readPersonIdFromForm(form: HTMLElement): string | null {
  const id = form.getAttribute('data-id') ?? form.getAttribute('data-person-id');
  if (id) return id;
  // Fallback: read main id from chart store
  try {
    return (state?.chart?.getStore?.()?.getMainDatum?.()?.id as string) ?? null;
  } catch {
    return null;
  }
}
