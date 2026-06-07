import f3 from '../../src/index';
import type { Chart } from '../../src/core/chart';
import type { EditTree } from '../../src/core/edit';
import { fetchTreeData, saveTreeData, StaleVersionError } from './db';
import {
  buildFormFields,
  cardPrimaryName,
  cardSecondaryName,
  getLanguage,
  lifeDates,
  toDisplayPeople,
  toDisplayPerson
} from './lang';
import { t, type I18nKey } from './i18n';
import { kinshipTerm } from './kinship';
import { AsYouType } from 'libphonenumber-js';
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

// Kinship "source": the person every card's term is computed relative to.
// Per-viewer (localStorage), not part of the shared tree data.
const KINSHIP_KEY = 'family-chart:kinship-source';
let kinshipSourceId: string | null =
  typeof localStorage !== 'undefined' ? localStorage.getItem(KINSHIP_KEY) : null;

function getKinshipSource(): string | null {
  return kinshipSourceId;
}
function setKinshipSource(id: string | null): void {
  kinshipSourceId = id;
  if (typeof localStorage === 'undefined') return;
  if (id) localStorage.setItem(KINSHIP_KEY, id);
  else localStorage.removeItem(KINSHIP_KEY);
}
function toggleKinshipSource(id: string): void {
  setKinshipSource(getKinshipSource() === id ? null : id);
  // Re-render card text + buttons without rebuilding the whole chart (keeps pan/zoom).
  state?.chart?.updateTree({});
  updateKinshipChip();
}

// The card's kinship line: the target's Chinese term relative to the source.
// Empty when no source is set or for the source's own card.
function kinshipCardLine(personId: string): string {
  const src = getKinshipSource();
  if (!src || !state || personId === src) return '';
  const r = kinshipTerm(src, personId, state.row.data);
  if (!r.term) return '';
  return r.ambiguous ? `${r.term}?` : r.term;
}

// Header chip showing the current kinship source with a clear (✕) control.
function updateKinshipChip(): void {
  const actions = document.querySelector('.app-header-actions');
  if (!actions) return;
  let chip = document.getElementById('kinship-chip');
  const src = getKinshipSource();
  const person = src && state ? state.row.data.find(p => p.id === src) : null;

  // No source, or source no longer in the tree → clear chip (and stale source).
  if (!src || !person) {
    if (src && !person) setKinshipSource(null);
    chip?.remove();
    return;
  }

  const name = cardPrimaryName(toDisplayPerson(person).data) || src;
  if (!chip) {
    chip = document.createElement('div');
    chip.id = 'kinship-chip';
    chip.className = 'kinship-chip';
    actions.insertBefore(chip, actions.firstChild);
  }
  chip.textContent = `${t('kinshipBasis')}: ${name} `;
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'kinship-chip-clear';
  clear.textContent = '✕';
  clear.title = t('kinshipClear');
  clear.addEventListener('click', () => {
    setKinshipSource(null);
    state?.chart?.updateTree({});
    updateKinshipChip();
  });
  chip.appendChild(clear);
}

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
    // Spacing must exceed the (now larger) card size or cards overlap.
    .setCardXSpacing(400)
    .setCardYSpacing(300)
    // Keep the focused person's siblings visible — otherwise clicking your own
    // card (making you the "main" person) hides your brothers/sisters.
    .setShowSiblingsOfMain(true) as Chart;

  const f3Card = (f3Chart as any).setCard((f3 as any).CardHtml)
    // Compute the name from the FLAT fields so newly-added cards (which lack the
    // read adapter's precomputed display_name) still show the name, not just the
    // birthday. Line 1 = primary name, line 2 = other-language name, line 3 = DOB.
    .setCardDisplay([
      (d: any) => cardPrimaryName(d.data),
      (d: any) => cardSecondaryName(d.data),
      // Line 3: life dates ("1940–2012" for deceased, birth year for living).
      (d: any) => lifeDates(d.data),
      // Line 4: Chinese kinship term relative to the chosen source (empty when none).
      (d: any) => kinshipCardLine(d.id)
    ])
    .setMiniTree(true)
    // Bigger cards + a larger photo so the picture is easy to see.
    .setCardDim({ width: 300, height: 150, img_width: 130, img_height: 130 })
    // Per-card decoration: click-to-expand photo, deceased dimming, contact popup.
    .setOnCardUpdate(decorateCard);

  if (state.canEdit) {
    // Pass field objects (not bare names) so the form shows readable,
    // per-language labels instead of raw ids like "first_name__zh-Hant".
    const fields = buildFormFields().map(f => ({ type: f.type, label: f.label, id: f.name, ...(f.options ? { options: f.options } : {}) }));
    const f3EditTree = f3Chart.editTree();
    f3EditTree
      .setFields(fields)
      .setEditFirst(false)
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
  updateKinshipChip();

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
      showToast(t('someoneUpdated'), 'error');
      await refreshTree();
    } else {
      console.error('Save failed', err);
      showToast(t('saveFailed').replace('{x}', (err as Error).message), 'error');
    }
  }
}

// ---------------------------------------------------------------------------
// Photo: click a card's picture to view it at full (original) size
// ---------------------------------------------------------------------------

// The contact fields shown in the click-to-view popup, in display order, with
// how to turn each value into a link (email/phone/socials).
const CONTACT_FIELDS: { key: string; labelKey: I18nKey; href?: (v: string) => string }[] = [
  { key: 'email',     labelKey: 'email',     href: v => `mailto:${v}` },
  { key: 'phone',     labelKey: 'phone',     href: v => `tel:${v.replace(/[^\d+]/g, '')}` },
  { key: 'wechat',    labelKey: 'wechat' },
  { key: 'instagram', labelKey: 'instagram', href: v => toSocialUrl(v, 'https://instagram.com/') },
  { key: 'facebook',  labelKey: 'facebook',  href: v => toSocialUrl(v, 'https://facebook.com/') },
  { key: 'linkedin',  labelKey: 'linkedin',  href: v => toSocialUrl(v, 'https://www.linkedin.com/in/') }
];

function toSocialUrl(v: string, base: string): string {
  return /^https?:\/\//i.test(v) ? v : base + v.replace(/^@/, '');
}

function hasContactInfo(person: Record<string, unknown>): boolean {
  return CONTACT_FIELDS.some(f => {
    const v = person[f.key];
    return typeof v === 'string' && v.trim() !== '';
  });
}

// Per-card decoration (setOnCardUpdate): `this` is the card_cont node, `d` the
// TreeDatum (person fields at d.data.data). Wires the photo lightbox, dims
// deceased cards, and adds a contact-info button when there's anything to show.
function decorateCard(this: HTMLElement, d: any): void {
  makePhotoExpandable.call(this);

  const person = (d?.data?.data ?? {}) as Record<string, unknown>;
  const cardEl = this.querySelector('.card') as HTMLElement | null;
  if (!cardEl) return;

  cardEl.classList.toggle('card-deceased', !!person.deceased);

  if (hasContactInfo(person) && !cardEl.querySelector('.f3-contact-btn')) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'f3-contact-btn';
    btn.textContent = 'ⓘ';
    btn.title = t('contactPopupTitle');
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // don't also open the edit form
      openContactPopup(person);
    });
    cardEl.appendChild(btn);
  }

  // Kinship "set as source" toggle. Highlights the current source; clicking any
  // other card makes it the source and recomputes every card's term.
  const personId = d?.data?.id as string | undefined;
  if (personId) {
    const isSource = getKinshipSource() === personId;
    cardEl.classList.toggle('card-kinship-source', isSource);
    let kb = cardEl.querySelector('.f3-kinship-btn') as HTMLButtonElement | null;
    if (!kb) {
      kb = document.createElement('button');
      kb.type = 'button';
      kb.className = 'f3-kinship-btn';
      kb.textContent = '称';
      kb.addEventListener('click', (e) => {
        e.stopPropagation(); // don't also open the edit form
        toggleKinshipSource(personId);
      });
      cardEl.appendChild(kb);
    }
    kb.classList.toggle('active', isSource);
    kb.title = isSource ? t('kinshipClear') : t('kinshipSetSource');
  }
}

// A small overlay listing a person's contact details. Dismiss on backdrop
// click or Escape. Built app-side (no library changes), like the photo lightbox.
function openContactPopup(person: Record<string, unknown>): void {
  const overlay = document.createElement('div');
  overlay.className = 'f3-contact-popup-overlay';
  const box = document.createElement('div');
  box.className = 'f3-contact-popup';

  const title = document.createElement('h3');
  title.textContent = t('contactPopupTitle');
  box.appendChild(title);

  const rows = CONTACT_FIELDS
    .map(f => ({ f, v: typeof person[f.key] === 'string' ? (person[f.key] as string).trim() : '' }))
    .filter(r => r.v);

  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = t('noContactInfo');
    box.appendChild(empty);
  } else {
    const dl = document.createElement('dl');
    dl.className = 'f3-contact-list';
    for (const { f, v } of rows) {
      const dt = document.createElement('dt');
      dt.textContent = t(f.labelKey);
      const dd = document.createElement('dd');
      if (f.href) {
        const a = document.createElement('a');
        a.href = f.href(v);
        a.textContent = v;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        dd.appendChild(a);
      } else {
        dd.textContent = v;
      }
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
    box.appendChild(dl);
  }

  overlay.appendChild(box);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
}

// Runs per card (via decorateCard). Attaches a click-to-expand handler to the
// card's <img> exactly once.
function makePhotoExpandable(this: HTMLElement): void {
  const img = this.querySelector('img') as HTMLImageElement | null;
  if (!img || img.dataset.expandWired) return;
  img.dataset.expandWired = '1';
  img.style.cursor = 'zoom-in';
  img.title = t('clickFullSize');
  img.addEventListener('click', (e) => {
    e.stopPropagation(); // don't also open the edit form
    openImageLightbox(img.src);
  });
}

function openImageLightbox(src: string): void {
  const overlay = document.createElement('div');
  overlay.className = 'f3-image-lightbox';
  const full = document.createElement('img');
  full.src = src;
  overlay.appendChild(full);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
}

// ---------------------------------------------------------------------------
// Tooltips: label the icon-only add / edit / remove / delete controls so it's
// clear what each does on hover.
// ---------------------------------------------------------------------------

function setActionTooltips(root: HTMLElement): void {
  const tooltips: [string, string][] = [
    ['.f3-add-relative-btn', t('addRelative')],
    ['.f3-remove-relative-btn', t('removeRelationship')],
    ['.f3-delete-btn', t('deletePerson')],
    ['.f3-close-btn', t('close')],
    ['.card_add_relative', t('addRelative')]
  ];
  for (const [sel, label] of tooltips) {
    root.querySelectorAll(sel).forEach(el => {
      if (el.getAttribute('title') === label) return;
      el.setAttribute('title', label);
      // SVG elements surface tooltips via a <title> child, not the attribute.
      if (el instanceof SVGElement && !el.querySelector('title')) {
        const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        titleEl.textContent = label;
        el.insertBefore(titleEl, el.firstChild);
      }
    });
  }
}

// Turn the icon-only "add relative" control into a clearly labelled button so
// non-technical users understand it. Re-applied on each form render.
function labelAddRelative(root: HTMLElement): void {
  const btn = root.querySelector<HTMLElement>('.f3-add-relative-btn');
  if (!btn) return;
  const active = !!btn.querySelector('[data-icon="user-plus-close"]'); // add-mode on
  // Idempotent: only mutate when something actually changes, otherwise our own
  // mutations re-trigger the MutationObserver in an infinite loop.
  if (!btn.classList.contains('f3-add-relative-as-button')) {
    btn.classList.add('f3-add-relative-as-button');
  }
  let label = btn.querySelector<HTMLElement>('.f3-add-relative-label');
  if (!label) {
    label = document.createElement('span');
    label.className = 'f3-add-relative-label';
    btn.appendChild(label);
  }
  const want = active ? t('cancel') : t('addRelative');
  if (label.textContent !== want) label.textContent = want;
}

// Turn the icon-only pencil toggle into a clearly labelled "Edit" button.
// Forms open read-only by default (setEditFirst false); this button switches
// the open form to editable. Styled to match the "Add Relative" button.
function labelEditToggle(root: HTMLElement): void {
  const btn = root.querySelector<HTMLElement>('.f3-edit-btn');
  if (!btn) return;
  if (btn.style.display === 'none') btn.style.display = '';
  if (!btn.classList.contains('f3-edit-as-button')) {
    btn.classList.add('f3-edit-as-button');
  }
  let label = btn.querySelector<HTMLElement>('.f3-edit-label');
  if (!label) {
    label = document.createElement('span');
    label.className = 'f3-edit-label';
    btn.appendChild(label);
  }
  const editing = !!btn.querySelector('[data-icon="pencil-off"]'); // edit mode on
  const want = editing ? t('stopEditing') : t('edit');
  if (label.textContent !== want) label.textContent = want;
}

// Translate the library-rendered form controls (Submit/Cancel/Delete/Remove
// Relation + Male/Female) into the current UI language. Idempotent.
function translateFormControls(root: HTMLElement): void {
  const form = root.querySelector('#familyForm');
  if (!form) return;
  const setText = (el: Element | null, text: string) => {
    if (el && (el.textContent || '').trim() !== text) el.textContent = text;
  };
  setText(form.querySelector('button[type="submit"]'), t('submit'));
  setText(form.querySelector('.f3-cancel-btn'), t('cancel'));
  setText(form.querySelector('.f3-delete-btn'), t('del'));
  const rmv = form.querySelector('.f3-remove-relative-btn');
  if (rmv && !rmv.classList.contains('active')) setText(rmv, t('removeRelation'));
  form.querySelectorAll('.f3-radio-group label').forEach(lbl => {
    const val = lbl.querySelector('input')?.getAttribute('value');
    const want = val === 'M' ? t('male') : val === 'F' ? t('female') : '';
    if (!want) return;
    const node = Array.from(lbl.childNodes).reverse().find(n => n.nodeType === Node.TEXT_NODE && (n.textContent || '').trim());
    if (node && (node.textContent || '').trim() !== want) node.textContent = want;
  });
}

// ---------------------------------------------------------------------------
// Photo upload: inject a file input into the edit form when it appears
// ---------------------------------------------------------------------------

function installPhotoUploadHook(root: HTMLElement): void {
  const observer = new MutationObserver(() => {
    // Label the icon-only add/edit/remove controls (cards + form) on hover.
    setActionTooltips(root);
    // Transform the pencil toggle into a labeled "Edit" button.
    labelEditToggle(root);
    // Make "add relative" a clearly labelled button for non-technical users.
    labelAddRelative(root);

    const form = root.querySelector('form');
    if (!form) return;

    // Translate the library's form buttons + gender labels into the UI language.
    translateFormControls(root);

    // Upgrade the plain birthday text input to a native date picker (calendar).
    const birthday = form.querySelector<HTMLInputElement>('[name="birthday"]');
    if (birthday && birthday.type !== 'date') {
      birthday.type = 'date';
      birthday.max = new Date().toISOString().slice(0, 10); // no future dates
    }

    // Same native date picker for the death date.
    const deathDate = form.querySelector<HTMLInputElement>('[name="death_date"]');
    if (deathDate && deathDate.type !== 'date') {
      deathDate.type = 'date';
      deathDate.max = new Date().toISOString().slice(0, 10);
    }

    // Render the "deceased" field as a checkbox; group the contact inputs.
    upgradeStatusField(form);
    groupContactFields(form);
    // Prefix the social fields so you only type the username.
    upgradeSocialPrefixes(form);
    // Live international phone formatting (+country code forced).
    upgradePhoneFormatter(form);

    if (form.querySelector('[data-photo-upload]')) return;

    const personId = readPersonIdFromForm(form);
    if (!personId) return;

    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-photo-upload', '');
    wrapper.style.margin = '10px 0';
    wrapper.innerHTML = `
      <label class="muted" style="display:block;margin-bottom:6px;">${t('profilePhoto')}</label>
      <button type="button" class="f3-photo-pick-btn">${t('choosePhoto')}</button>
      <span class="f3-photo-filename muted">${t('noPhotoChosen')}</span>
      <input type="file" accept="image/*" style="display:none" />
    `;
    const input = wrapper.querySelector('input') as HTMLInputElement;
    const pickBtn = wrapper.querySelector('.f3-photo-pick-btn') as HTMLButtonElement;
    const fileNameEl = wrapper.querySelector('.f3-photo-filename') as HTMLElement;
    pickBtn.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      fileNameEl.textContent = file.name;
      try {
        const path = await uploadAvatar(personId, file);
        // Set the avatar text field so the library notices the change
        const avatarInput = form.querySelector<HTMLInputElement>('[name="avatar"], [id="avatar"]');
        if (avatarInput) {
          avatarInput.value = path;
          avatarInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        showToast(t('photoUploaded'));
      } catch (err) {
        console.error(err);
        showToast(t('uploadFailed').replace('{x}', (err as Error).message), 'error');
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

// The library renders the "deceased" field as a text input. Replace it with a
// Living/Deceased <select> (a clear status, not a yes/no question), keeping the
// original (hidden) input as the value the library reads on submit. The select
// writes 'true'/'' into that input (mergePersonUpdate coerces to boolean) and
// dispatches `input`. The "Date of passing" field shows only when Deceased.
function upgradeStatusField(form: HTMLElement): void {
  const input = form.querySelector<HTMLInputElement>('[name="deceased"]');
  if (!input || input.dataset.statusWired) return;
  input.dataset.statusWired = '1';

  const deathField = form.querySelector('[name="death_date"]')
    ?.closest('.f3-form-field') as HTMLElement | null;

  // Initialise from the stored person (robust against the library not
  // populating boolean fields); fall back to whatever value is in the input.
  const personId = readPersonIdFromForm(form);
  const person = personId ? state?.row.data.find(p => p.id === personId) ?? null : null;
  const isDeceased = person ? !!person.data.deceased : input.value === 'true';
  input.value = isDeceased ? 'true' : ''; // keep the hidden value in sync silently

  // Hide the raw text input; keep it in the DOM (the library reads/persists it).
  input.style.display = 'none';

  const setDeathVisible = (v: boolean) => {
    if (deathField) deathField.style.display = v ? '' : 'none';
  };
  setDeathVisible(isDeceased); // death date only when deceased

  const select = document.createElement('select');
  select.className = 'f3-status-select';
  const living = document.createElement('option');
  living.value = '';
  living.textContent = t('living');
  const dead = document.createElement('option');
  dead.value = 'deceased';
  dead.textContent = t('deceasedStatus');
  select.append(living, dead);
  select.value = isDeceased ? 'deceased' : '';

  select.addEventListener('change', () => {
    const dec = select.value === 'deceased';
    input.value = dec ? 'true' : '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    setDeathVisible(dec);
    if (!dec) {
      // No longer deceased → clear any date of passing too.
      const dd = form.querySelector<HTMLInputElement>('[name="death_date"]');
      if (dd && dd.value) {
        dd.value = '';
        dd.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  });

  // Place the select where the hidden input is (within its "Status" field).
  input.parentElement?.appendChild(select);
}

// Move the contact inputs into one collapsible <details> fieldset so the form
// isn't a wall of mostly-empty inputs. Open by default only when the person
// already has a contact value. Idempotent (guarded by data-contact-group).
function groupContactFields(form: HTMLElement): void {
  if (form.querySelector('[data-contact-group]')) return;
  const keys = ['email', 'phone', 'wechat', 'instagram', 'facebook', 'linkedin'];
  const wrappers: HTMLElement[] = [];
  for (const k of keys) {
    const input = form.querySelector<HTMLInputElement>(`[name="${k}"]`);
    const w = input?.closest('.f3-form-field') as HTMLElement | null;
    if (w) wrappers.push(w);
  }
  if (wrappers.length === 0) return;

  const details = document.createElement('details');
  details.className = 'f3-contact-group';
  details.setAttribute('data-contact-group', '');
  const summary = document.createElement('summary');
  summary.textContent = t('contactInfo');
  details.appendChild(summary);
  details.open = wrappers.some(w => {
    const i = w.querySelector('input');
    return i instanceof HTMLInputElement && i.value.trim() !== '';
  });

  wrappers[0].parentElement?.insertBefore(details, wrappers[0]);
  for (const w of wrappers) details.appendChild(w);
}

// Social handle prefixes — the user types only the username; the value stored
// is the bare username, and the contact popup prepends the base URL
// (see CONTACT_FIELDS / toSocialUrl), so display and storage stay consistent.
const SOCIAL_PREFIXES: Record<string, string> = {
  instagram: 'instagram.com/',
  facebook: 'facebook.com/',
  linkedin: 'linkedin.com/in/'
};

// Prepend a fixed, non-editable prefix to each social input so only the
// username is typed. Idempotent (guarded by data-prefix-wired).
function upgradeSocialPrefixes(form: HTMLElement): void {
  for (const [key, prefix] of Object.entries(SOCIAL_PREFIXES)) {
    const input = form.querySelector<HTMLInputElement>(`[name="${key}"]`);
    if (!input || input.dataset.prefixWired) continue;
    input.dataset.prefixWired = '1';
    input.placeholder = 'username';
    const row = document.createElement('div');
    row.className = 'f3-social-row';
    const span = document.createElement('span');
    span.className = 'f3-social-prefix';
    span.textContent = prefix;
    input.parentElement?.insertBefore(row, input);
    row.appendChild(span);
    row.appendChild(input); // moves the input into the row, after the prefix
  }
}

// Live international phone formatting via libphonenumber-js. Forces a leading
// "+" (so the international code is always present) and formats as you type:
// +1 408 123 1234, +86 138 0013 8000, etc. Per-country grouping is handled by
// the library. Idempotent (guarded by data-phone-wired).
function upgradePhoneFormatter(form: HTMLElement): void {
  const input = form.querySelector<HTMLInputElement>('[name="phone"]');
  if (!input || input.dataset.phoneWired) return;
  input.dataset.phoneWired = '1';
  input.type = 'tel';
  input.placeholder = '+1 408-123-4567';

  const reformat = () => {
    const raw = input.value;
    if (raw.trim() === '') return; // allow clearing the field
    const withCode = raw.startsWith('+') ? raw : '+' + raw;
    const digits = withCode.replace(/\D/g, '');
    // US/NANP (country code 1): the requested +1(408)799-9281 parens style.
    // Everything else: libphonenumber's standard international format.
    input.value = digits.startsWith('1')
      ? formatNanp(digits)
      : new AsYouType().input(withCode);
  };
  input.addEventListener('input', reformat);
  reformat(); // normalise any pre-filled value when the form opens
}

// Progressive +1 AAA-BBB-CCCC formatter for NANP numbers (the style Google
// autofill uses). `digits` includes the leading country code 1; up to 10
// national digits are used.
function formatNanp(digits: string): string {
  const nat = digits.slice(1, 11);
  let out = '+1';
  if (nat.length > 0) {
    out += ' ' + nat.slice(0, 3);
    if (nat.length > 3) out += '-' + nat.slice(3, 6);
    if (nat.length > 6) out += '-' + nat.slice(6, 10);
  }
  return out;
}
