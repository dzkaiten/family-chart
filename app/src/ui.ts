// Tiny UI helpers: toasts and DOM utilities.

export function showToast(message: string, kind: 'info' | 'error' = 'info', durationMs = 3500): void {
  const root = document.getElementById('toast-root');
  if (!root) {
    console[kind === 'error' ? 'error' : 'log'](message);
    return;
  }
  const el = document.createElement('div');
  el.className = `toast${kind === 'error' ? ' toast-error' : ''}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 200ms';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 250);
  }, durationMs);
}

export function setHidden(id: string, hidden: boolean): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('hidden', hidden);
}

export function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  children: (string | Node)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'className' && typeof value === 'string') node.className = value;
    else if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
      (node as any)[key] = value;
    }
  }
  for (const child of children) {
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}
