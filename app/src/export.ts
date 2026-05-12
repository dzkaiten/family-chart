import { toPng } from 'html-to-image';
import { fetchTreeData } from './db';
import { showToast } from './ui';
import type { StoredPerson } from './types';

function todayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Strip avatar fields from each person; the JSON download is relationships +
// names only, per spec.
function stripAvatars(people: StoredPerson[]): StoredPerson[] {
  return people.map(p => {
    const { avatar: _drop, ...rest } = p.data;
    return { ...p, data: rest as StoredPerson['data'] };
  });
}

export async function downloadJSON(): Promise<void> {
  try {
    const row = await fetchTreeData();
    if (!row) throw new Error('No tree data');
    const sanitized = stripAvatars(row.data);
    const payload = {
      exported_at: new Date().toISOString(),
      data_version: row.data_version,
      tree_id: row.tree_id,
      people: sanitized
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    triggerDownload(blob, `family-tree-${todayStamp()}.json`);
  } catch (err) {
    showToast(`Download failed: ${(err as Error).message}`, 'error');
  }
}

export async function downloadPNG(): Promise<void> {
  const target = document.querySelector('#tree-container') as HTMLElement | null;
  if (!target) {
    showToast('No tree to capture', 'error');
    return;
  }
  try {
    // Wait for all images to finish loading so they appear in the capture
    const images = Array.from(target.querySelectorAll('img'));
    await Promise.all(images.map(waitForImage));

    const dataUrl = await toPng(target, {
      cacheBust: true,
      pixelRatio: 2,
      backgroundColor: '#ffffff'
    });
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    triggerDownload(blob, `family-tree-${todayStamp()}.png`);
  } catch (err) {
    console.error(err);
    showToast(`Image export failed: ${(err as Error).message}`, 'error');
  }
}

function waitForImage(img: HTMLImageElement): Promise<void> {
  if (img.complete && img.naturalWidth > 0) return Promise.resolve();
  return new Promise(resolve => {
    img.addEventListener('load', () => resolve(), { once: true });
    img.addEventListener('error', () => resolve(), { once: true });
  });
}
