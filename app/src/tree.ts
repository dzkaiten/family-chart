import f3 from '../../src/index';
import type { Chart } from '../../src/core/chart';
import type { EditTree } from '../../src/core/edit';
import { fetchTreeData, saveTreeData, StaleVersionError } from './db';
import {
  buildFormFields,
  getLanguage,
  toDisplayPeople
} from './lang';
import { mapExportedToStored, buildOriginalIndex } from './persist';
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
  chart: Chart | null;
  editTree: EditTree | null;
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
    editTree: null,
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
  // The family-chart library scopes ALL its styles under `.f3` (flex layout,
  // SVG sizing, card colors, and the CSS custom properties the edit form reads).
  // The library never adds this class itself — every example puts it on the
  // container — so without it the tree renders unstyled and the edit form is
  // invisible. See src/styles/family-chart.css (`.f3 { display:flex }` etc.).
  state.container.innerHTML = '<div id="tree-container" class="tree-root f3"></div>';
  const treeEl = state.container.querySelector('#tree-container') as HTMLElement;

  // Seed an empty starter datum if the tree has no people yet, so the user
  // sees a usable starting point.
  const wasEmpty = state.row.data.length === 0;
  const sourcePeople = wasEmpty ? seedFirstPerson() : state.row.data;
  const display = toDisplayPeople(sourcePeople);
  const withSigned = await resolveAvatarUrls(display);

  const f3Chart = (f3 as any).createChart(treeEl, withSigned)
    .setTransitionTime(800)
    .setCardXSpacing(250)
    .setCardYSpacing(150) as Chart;

  const f3Card = (f3Chart as any).setCard((f3 as any).CardHtml)
    // Show the single, culturally-ordered display_name (computed in lang.ts)
    // instead of first+last, so Chinese names render surname-first with no space.
    .setCardDisplay([['display_name'], ['birthday']])
    .setMiniTree(true);

  if (state.canEdit) {
    // Pass field objects (not bare names) so the form shows readable,
    // per-language labels instead of raw ids like "first_name__zh-Hant".
    const fields = buildFormFields().map(f => ({ type: f.type, label: f.label, id: f.name, ...(f.options ? { options: f.options } : {}) }));
    const f3EditTree = f3Chart.editTree();
    f3EditTree
      .setFields(fields)
      .setEditFirst(true)
      .setCardClickOpen(f3Card)
      .setOnChange(() => { scheduleSave(); });
    state.editTree = f3EditTree;
    // Inject a photo upload button into the form when it opens
    installPhotoUploadHook(state.container);
  } else {
    state.editTree = null;
    (f3Card as any).setOnCardClick((_e: any, d: any) => f3Chart.updateMainId(d.data.id));
  }

  state.chart = f3Chart;
  f3Chart.updateTree({ initial: true });

  // The library's setEditFirst() does NOT auto-open a form (it only makes an
  // opened form editable). For a brand-new, empty tree, open the starter
  // person's form so the user has somewhere to enter the first person. This
  // mirrors the official edit example (examples/htmls/v2/17-edit-tree.html),
  // which calls editTree.open(getMainDatum()) then re-renders so the layout
  // accounts for the form panel.
  if (state.canEdit && state.editTree && wasEmpty) {
    state.editTree.open(f3Chart.getMainDatum());
    f3Chart.updateTree({ initial: true });
  }
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
  if (!state || !state.editTree) return;
  // exportData() is the library's supported way to read edited data
  // (src/core/edit.ts). It deep-clones and cleans internal/temp fields.
  const libData = state.editTree.exportData() as unknown as DisplayPerson[];
  const beforePeople = state.row.data;
  const stored = mapExportedToStored(
    libData,
    buildOriginalIndex(beforePeople),
    state.avatarPaths,
    getLanguage()
  );

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

    // Hide the raw "avatar" URL field (confusing — "What is avatar?") and drop
    // the photo uploader in its place. The hidden input still carries the value
    // we set after upload, which the library persists on save.
    const avatarField = form.querySelector<HTMLInputElement>('[name="avatar"], [id="avatar"]')
      ?.closest('.f3-form-field') as HTMLElement | null;
    if (avatarField) {
      avatarField.style.display = 'none';
      avatarField.parentElement?.insertBefore(wrapper, avatarField);
    } else {
      const btnRow = form.querySelector('.f3-form-buttons');
      if (btnRow) btnRow.before(wrapper);
      else form.appendChild(wrapper);
    }
  });
  observer.observe(root, { childList: true, subtree: true });
}

function readPersonIdFromForm(form: HTMLElement): string | null {
  const id = form.getAttribute('data-id') ?? form.getAttribute('data-person-id');
  if (id) return id;
  // Fallback: read main id from chart store
  try {
    return (state?.chart?.getMainDatum?.()?.id as string) ?? null;
  } catch {
    return null;
  }
}
