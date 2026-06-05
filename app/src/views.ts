// View rendering for the login + access-request screens. The tree itself
// renders into the same root via tree.ts.

import { sendMagicLink } from './auth';
import { submitAccessRequest } from './db';
import { el, showToast } from './ui';

export function renderLoginView(root: HTMLElement): void {
  root.innerHTML = '';
  const wrap = el('div', { className: 'view-centered' });
  const card = el('div', { className: 'card' });

  card.appendChild(el('h2', {}, ['Sign in']));
  card.appendChild(el('p', {}, [
    'Enter your email to receive a magic sign-in link. You must be on the allowlist to view or edit the family tree.'
  ]));

  const field = el('div', { className: 'field' });
  field.appendChild(el('label', { htmlFor: 'login-email' }, ['Email']));
  const input = el('input', {
    id: 'login-email',
    type: 'email',
    placeholder: 'you@example.com',
    required: true
  });
  field.appendChild(input);
  card.appendChild(field);

  const send = el('button', { className: 'btn', type: 'button' }, ['Send magic link']);
  const requestBtn = el('button', { className: 'btn btn-ghost', type: 'button' }, ['Request access']);

  const btnRow = el('div', { className: 'btn-row' });
  btnRow.appendChild(send);
  btnRow.appendChild(requestBtn);
  card.appendChild(btnRow);

  send.addEventListener('click', async () => {
    const email = input.value.trim();
    if (!email) {
      showToast('Enter an email address', 'error');
      return;
    }
    send.setAttribute('disabled', 'true');
    try {
      await sendMagicLink(email);
      send.textContent = 'Sent — check your inbox';
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
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

  card.appendChild(el('h2', {}, ['Request access']));
  card.appendChild(el('p', {}, [
    'The tree owner will see your request and can approve it from inside the app. Once approved, sign in with the email below.'
  ]));

  const nameField = el('div', { className: 'field' });
  nameField.appendChild(el('label', { htmlFor: 'req-name' }, ['Your name']));
  const nameInput = el('input', { id: 'req-name', type: 'text', required: true });
  nameField.appendChild(nameInput);
  card.appendChild(nameField);

  const emailField = el('div', { className: 'field' });
  emailField.appendChild(el('label', { htmlFor: 'req-email' }, ['Email']));
  const emailInput = el('input', {
    id: 'req-email',
    type: 'email',
    placeholder: 'you@example.com',
    required: true
  });
  emailField.appendChild(emailInput);
  card.appendChild(emailField);

  const submit = el('button', { className: 'btn', type: 'button' }, ['Submit request']);
  const back = el('button', { className: 'btn btn-ghost', type: 'button' }, ['Back']);

  const btnRow = el('div', { className: 'btn-row' });
  btnRow.appendChild(submit);
  btnRow.appendChild(back);
  card.appendChild(btnRow);

  submit.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    if (!name || !email) {
      showToast('Please enter both name and email', 'error');
      return;
    }
    submit.setAttribute('disabled', 'true');
    try {
      await submitAccessRequest(name, email);
      card.innerHTML = '';
      card.appendChild(el('h2', {}, ['Request submitted']));
      card.appendChild(el('p', {}, [
        `Thanks, ${name}. The owner will see your request inside the app. Once approved, sign in with ${email}.`
      ]));
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
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

  card.appendChild(el('h2', {}, ['Awaiting approval']));
  card.appendChild(el('p', {}, [
    `You're signed in as ${email}, but you're not on the allowlist yet. Submit a request below and the owner will be notified inside the app.`
  ]));

  const btn = el('button', { className: 'btn', type: 'button' }, ['Submit access request']);
  btn.addEventListener('click', () => renderRequestView(root));
  card.appendChild(btn);

  wrap.appendChild(card);
  root.appendChild(wrap);
}
