// The family-chart library's stylesheet lives in ../src (outside the app/ Vite
// root), so it must be imported through the module graph via the @lib alias
// (see app/vite.config.ts) rather than a <link> in index.html, which Vite would
// serve as the SPA fallback (200 but empty). Without this, no .f3 styles apply.
import '@lib/styles/family-chart.css';
import { getCurrentSession, onAuthStateChange, signOut } from './auth';
import { fetchTreeMeta } from './db';
import { downloadJSON, downloadPNG } from './export';
import { initLanguage, setLanguage } from './lang';
import type { LanguageCode } from './config';
import { initAdminBadge } from './admin';
import { initTree, rerenderForLanguage } from './tree';
import { renderLoginView, renderPendingView } from './views';
import { setHidden, showToast } from './ui';
import type { Session } from './types';

const viewRoot = document.getElementById('view-root') as HTMLElement;
const langToggle = document.getElementById('lang-toggle') as HTMLSelectElement;
const logoutBtn = document.getElementById('logout-btn') as HTMLButtonElement;
const downloadJsonBtn = document.getElementById('download-json-btn') as HTMLButtonElement;
const downloadPngBtn = document.getElementById('download-png-btn') as HTMLButtonElement;

let currentSession: Session | null = null;

async function mount(session: Session | null): Promise<void> {
  currentSession = session;
  if (!session) {
    showHeaderForUnauthed();
    renderLoginView(viewRoot);
    return;
  }
  if (session.role === null) {
    showHeaderForUnauthed();
    renderPendingView(viewRoot, session.email);
    return;
  }
  await mountTree(session);
}

async function mountTree(session: Session): Promise<void> {
  showHeaderForAuthed(session);
  try {
    await initTree(viewRoot, true);
  } catch (err) {
    console.error(err);
    showToast(`Failed to load tree: ${(err as Error).message}`, 'error');
    viewRoot.innerHTML = `<div class="view-centered"><div class="card"><h2>Could not load tree</h2><p>${(err as Error).message}</p></div></div>`;
  }
  initAdminBadge(session.role === 'owner');
}

function showHeaderForUnauthed(): void {
  setHidden('admin-btn', true);
  setHidden('admin-badge', true);
  setHidden('logout-btn', true);
  setHidden('download-json-btn', true);
  setHidden('download-png-btn', true);
}

function showHeaderForAuthed(_session: Session): void {
  setHidden('logout-btn', false);
  setHidden('download-json-btn', false);
  setHidden('download-png-btn', false);
}

// ---------------------------------------------------------------------------
// Wire up header controls
// ---------------------------------------------------------------------------

langToggle.addEventListener('change', async () => {
  const newLang = langToggle.value as LanguageCode;
  setLanguage(newLang);
  if (currentSession?.role) {
    await rerenderForLanguage();
  }
});

logoutBtn.addEventListener('click', async () => {
  await signOut();
});

downloadJsonBtn.addEventListener('click', () => { void downloadJSON(); });
downloadPngBtn.addEventListener('click', () => { void downloadPNG(); });

document.addEventListener('admin:exit', async () => {
  if (currentSession?.role) await mountTree(currentSession);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  // Initialize language preference (tree default may not be available yet)
  let treeDefault: string | undefined;
  try {
    const meta = await fetchTreeMeta();
    treeDefault = meta?.default_language;
  } catch {
    // fetchTreeMeta requires an active session in most cases; ignore.
  }
  const lang = initLanguage(treeDefault ?? null);
  langToggle.value = lang;

  const session = await getCurrentSession();
  await mount(session);

  onAuthStateChange(async newSession => {
    await mount(newSession);
  });
}

boot().catch(err => {
  console.error(err);
  showToast(`Startup error: ${(err as Error).message}`, 'error');
});
