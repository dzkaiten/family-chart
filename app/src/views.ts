// View rendering for the login + access-request screens. The tree itself
// renders into the same root via tree.ts.

import { sendMagicLink } from './auth';
import { submitAccessRequest } from './db';
import { el, showToast } from './ui';
import { t } from './i18n';

export function renderLoginView(root: HTMLElement): void {
  root.innerHTML = '';
  const wrap = el('div', { className: 'view-centered' });
  const card = el('div', { className: 'card' });

  card.appendChild(el('h2', {}, [t('signIn')]));
  card.appendChild(el('p', {}, [t('signInDesc')]));

  const field = el('div', { className: 'field' });
  field.appendChild(el('label', { htmlFor: 'login-email' }, [t('email')]));
  const input = el('input', {
    id: 'login-email',
    type: 'email',
    placeholder: 'you@example.com',
    required: true
  });
  field.appendChild(input);
  card.appendChild(field);

  const send = el('button', { className: 'btn', type: 'button' }, [t('sendMagicLink')]);
  const requestBtn = el('button', { className: 'btn btn-ghost', type: 'button' }, [t('requestAccess')]);

  const btnRow = el('div', { className: 'btn-row' });
  btnRow.appendChild(send);
  btnRow.appendChild(requestBtn);
  card.appendChild(btnRow);

  send.addEventListener('click', async () => {
    const email = input.value.trim();
    if (!email) {
      showToast(t('enterEmail'), 'error');
      return;
    }
    send.setAttribute('disabled', 'true');
    try {
      await sendMagicLink(email);
      send.textContent = t('sentCheckInbox');
    } catch (err) {
      showToast((err as Error).message, 'error');
      send.removeAttribute('disabled');
    }
  });

  requestBtn.addEventListener('click', () => renderRequestView(root));

  wrap.appendChild(card);
  root.appendChild(wrap);
}

export function renderRequestView(root: HTMLElement): void {
  root.innerHTML = '';
  const wrap = el('div', { className: 'view-centered' });
  const card = el('div', { className: 'card' });

  card.appendChild(el('h2', {}, [t('requestAccess')]));
  card.appendChild(el('p', {}, [t('requestDesc')]));

  const nameField = el('div', { className: 'field' });
  nameField.appendChild(el('label', { htmlFor: 'req-name' }, [t('yourName')]));
  const nameInput = el('input', { id: 'req-name', type: 'text', required: true });
  nameField.appendChild(nameInput);
  card.appendChild(nameField);

  const emailField = el('div', { className: 'field' });
  emailField.appendChild(el('label', { htmlFor: 'req-email' }, [t('email')]));
  const emailInput = el('input', {
    id: 'req-email',
    type: 'email',
    placeholder: 'you@example.com',
    required: true
  });
  emailField.appendChild(emailInput);
  card.appendChild(emailField);

  const submit = el('button', { className: 'btn', type: 'button' }, [t('submitRequest')]);
  const back = el('button', { className: 'btn btn-ghost', type: 'button' }, [t('back')]);

  const btnRow = el('div', { className: 'btn-row' });
  btnRow.appendChild(submit);
  btnRow.appendChild(back);
  card.appendChild(btnRow);

  submit.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    if (!name || !email) {
      showToast(t('enterNameEmail'), 'error');
      return;
    }
    submit.setAttribute('disabled', 'true');
    try {
      await submitAccessRequest(name, email);
      card.innerHTML = '';
      card.appendChild(el('h2', {}, [t('requestSubmitted')]));
      card.appendChild(el('p', {}, [t('requestThanks').replace('{x}', email)]));
    } catch (err) {
      showToast((err as Error).message, 'error');
      submit.removeAttribute('disabled');
    }
  });

  back.addEventListener('click', () => renderLoginView(root));

  wrap.appendChild(card);
  root.appendChild(wrap);
}

export function renderPendingView(root: HTMLElement, email: string): void {
  root.innerHTML = '';
  const wrap = el('div', { className: 'view-centered' });
  const card = el('div', { className: 'card' });

  card.appendChild(el('h2', {}, [t('awaitingApproval')]));
  card.appendChild(el('p', {}, [t('awaitingDesc').replace('{x}', email)]));

  const btn = el('button', { className: 'btn', type: 'button' }, [t('submitAccessRequest')]);
  btn.addEventListener('click', () => renderRequestView(root));
  card.appendChild(btn);

  wrap.appendChild(card);
  root.appendChild(wrap);
}
