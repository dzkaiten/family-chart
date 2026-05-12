import { approveRequest, denyRequest, fetchPendingRequests } from './db';
import { el, setHidden, setText, showToast } from './ui';
import type { AccessRequest } from './types';

let cachedCount = 0;
let isOwner = false;

export function initAdminBadge(ownerFlag: boolean): void {
  isOwner = ownerFlag;
  if (!isOwner) {
    setHidden('admin-btn', true);
    return;
  }
  setHidden('admin-btn', false);
  const btn = document.getElementById('admin-btn');
  btn?.addEventListener('click', openAdminPanel);
  refreshAdminBadge();
}

export async function refreshAdminBadge(): Promise<void> {
  if (!isOwner) return;
  try {
    const reqs = await fetchPendingRequests();
    cachedCount = reqs.length;
    setText('admin-badge', String(cachedCount));
    setHidden('admin-badge', cachedCount === 0);
  } catch (err) {
    console.warn('Failed to fetch pending requests', err);
  }
}

async function openAdminPanel(): Promise<void> {
  const root = document.getElementById('view-root');
  if (!root) return;

  let requests: AccessRequest[];
  try {
    requests = await fetchPendingRequests();
  } catch (err) {
    showToast(`Failed to load requests: ${(err as Error).message}`, 'error');
    return;
  }

  // Save the current view so we can return to it
  const previousHTML = root.innerHTML;
  root.innerHTML = '';
  const container = el('div', { className: 'view-centered' });
  const card = el('div', { className: 'card' });
  card.style.maxWidth = '640px';
  card.appendChild(el('h2', {}, ['Pending access requests']));

  if (requests.length === 0) {
    card.appendChild(el('p', { className: 'muted' }, ['No pending requests.']));
  } else {
    const list = el('div', { className: 'request-list' });
    for (const req of requests) {
      list.appendChild(renderRequestRow(req, async () => {
        await openAdminPanel(); // refresh
      }));
    }
    card.appendChild(list);
  }

  const actions = el('div', { className: 'btn-row' });
  const back = el('button', { className: 'btn btn-ghost', type: 'button' }, ['Back to tree']);
  back.addEventListener('click', () => {
    root.innerHTML = previousHTML;
    // Note: returning to a cached innerHTML won't restart the chart cleanly.
    // The caller should call refreshTree() instead in that flow. For now we
    // signal a custom event so main.ts can re-mount.
    document.dispatchEvent(new CustomEvent('admin:exit'));
  });
  actions.appendChild(back);
  card.appendChild(actions);

  container.appendChild(card);
  root.appendChild(container);
}

function renderRequestRow(req: AccessRequest, onResolved: () => void): HTMLElement {
  const row = el('div', { className: 'request-row' });
  const info = el('div', { className: 'request-row-info' });
  info.appendChild(el('strong', {}, [req.name || '(no name)']));
  info.appendChild(el('span', { className: 'muted' }, [req.email]));
  row.appendChild(info);

  const actions = el('div', { className: 'btn-row' });
  const approve = el('button', { className: 'btn', type: 'button' }, ['Approve']);
  const deny = el('button', { className: 'btn btn-ghost', type: 'button' }, ['Deny']);
  approve.addEventListener('click', async () => {
    approve.setAttribute('disabled', 'true');
    deny.setAttribute('disabled', 'true');
    try {
      await approveRequest(req);
      showToast(`Approved ${req.email}`);
      await refreshAdminBadge();
      onResolved();
    } catch (err) {
      showToast(`Approve failed: ${(err as Error).message}`, 'error');
      approve.removeAttribute('disabled');
      deny.removeAttribute('disabled');
    }
  });
  deny.addEventListener('click', async () => {
    approve.setAttribute('disabled', 'true');
    deny.setAttribute('disabled', 'true');
    try {
      await denyRequest(req);
      showToast(`Denied ${req.email}`);
      await refreshAdminBadge();
      onResolved();
    } catch (err) {
      showToast(`Deny failed: ${(err as Error).message}`, 'error');
      approve.removeAttribute('disabled');
      deny.removeAttribute('disabled');
    }
  });
  actions.appendChild(approve);
  actions.appendChild(deny);
  row.appendChild(actions);

  return row;
}
