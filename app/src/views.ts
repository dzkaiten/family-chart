// Login view. The tree itself renders into the same root via tree.ts.

import { signInWithPassword } from './auth';
import { FAMILY_EMAIL } from './config';
import { el, showToast } from './ui';
import { t } from './i18n';

export function renderLoginView(root: HTMLElement): void {
  root.innerHTML = '';
  const wrap = el('div', { className: 'view-centered' });
  const card = el('div', { className: 'card' });

  card.appendChild(el('h2', {}, [t('signIn')]));
  card.appendChild(el('p', {}, [t('signInDesc')]));

  const emailField = el('div', { className: 'field' });
  emailField.appendChild(el('label', { htmlFor: 'login-email' }, [t('email')]));
  const emailInput = el('input', {
    id: 'login-email',
    type: 'email',
    value: FAMILY_EMAIL,
    required: true
  });
  emailField.appendChild(emailInput);
  card.appendChild(emailField);

  const pwField = el('div', { className: 'field' });
  pwField.appendChild(el('label', { htmlFor: 'login-password' }, [t('password')]));
  const pwInput = el('input', {
    id: 'login-password',
    type: 'password',
    required: true
  });
  pwField.appendChild(pwInput);
  card.appendChild(pwField);

  const signIn = el('button', { className: 'btn', type: 'button' }, [t('signIn')]);
  const btnRow = el('div', { className: 'btn-row' });
  btnRow.appendChild(signIn);
  card.appendChild(btnRow);

  async function submit(): Promise<void> {
    const email = emailInput.value.trim();
    if (!email || !pwInput.value) {
      showToast(t('enterEmailPassword'), 'error');
      return;
    }
    signIn.setAttribute('disabled', 'true');
    try {
      await signInWithPassword(email, pwInput.value);
      // On success, onAuthStateChange (main.ts) re-mounts the tree.
    } catch (err) {
      showToast(t('signInFailed').replace('{x}', (err as Error).message), 'error');
      signIn.removeAttribute('disabled');
    }
  }

  signIn.addEventListener('click', () => { void submit(); });
  pwInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') void submit();
  });

  wrap.appendChild(card);
  root.appendChild(wrap);
}
