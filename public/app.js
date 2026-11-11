const list = document.querySelector('#meetingList');
const counter = document.querySelector('#navCounter');
const headingCount = document.querySelector('#headingCount');
const videoInput = document.querySelector('#videoInput');
const dropZone = document.querySelector('#dropZone');
const toast = document.querySelector('#toast');
let meetings = [];
let toastTimer;
let knownStatuses = new Map();

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const icon = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5.5 3.5h6l3 3v10h-9z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M11.5 3.8v3h3m-6 3.5h3.5m-3.5 2.5h3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

function notify(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 6500);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date).replace(' г.', '');
}

const yandexDate = (value) => value ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)) : '';

async function refreshYandexStatus() {
  try {
    const response = await fetch('/api/yandex/status');
    if (!response.ok) return;
    const state = await response.json();
    const status = document.querySelector('#yandexConnectionStatus');
    const folder = document.querySelector('#yandexFolderPath');
    const lastCheck = document.querySelector('#yandexLastCheck');
    const result = document.querySelector('#yandexPollResult');
    const connect = document.querySelector('#yandexConnect');
    const poll = document.querySelector('#yandexPoll');
    const disconnect = document.querySelector('#yandexDisconnect');
    status.textContent = state.status;
    status.classList.toggle('connected', state.connected);
    folder.textContent = state.folder_path;
    lastCheck.textContent = `Последняя проверка: ${state.last_check_at ? yandexDate(state.last_check_at) : 'ещё не выполнялась'}`;
    connect.hidden = !state.configured;
    connect.textContent = state.connected ? 'Подключить заново' : (state.status.includes('повторное подключение') ? 'Подключить заново' : 'Подключить');
    poll.disabled = !state.connected || state.polling;
    poll.textContent = state.polling ? 'Проверка выполняется…' : 'Проверить сейчас';
    disconnect.hidden = !state.connected;
    const summary = state.last_result;
    result.textContent = summary ? `${summary.ok ? `Найдено файлов: ${summary.found || 0} · обработано: ${summary.processed || 0}` : (summary.message || 'Проверка не удалась')}${summary.errors?.length ? ` · ошибок: ${summary.errors.length}` : ''}` : '';
  } catch { /* Status is optional; the main archive remains usable offline. */ }
}

function itemList(items, title) {
  const safe = Array.isArray(items) ? items : [];
  return `<div class="detail-block"><h4>${title}</h4>${safe.length ? `<ul>${safe.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<span class="no-items">Ничего не отмечено</span>'}</div>`;
}

function render() {
  const disclosureStates = new Map([...list.querySelectorAll('.meeting-row')].map((row) => [
    row.dataset.id,
    {
      expanded: row.classList.contains('expanded'),
      nested: [...row.querySelectorAll('details')].map((disclosure) => disclosure.open),
    },
  ]));
  const visible = [...meetings].sort((a, b) => new Date(b.added_at) - new Date(a.added_at));
  counter.textContent = String(visible.length);
  headingCount.textContent = String(visible.length);
  if (!visible.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon}</div><div class="empty-copy"><strong>Здесь появятся ваши встречи</strong><span>Добавьте видеозапись сверху — всё остальное произойдёт автоматически.</span></div></div>`;
    return;
  }
  list.innerHTML = visible.map((meeting) => {
    const status = meeting.status === 'done' ? 'Готово' : meeting.status === 'error' ? 'Ошибка' : meeting.stage || 'Обрабатывается';
    const statusClass = meeting.status === 'done' ? 'done' : meeting.status === 'error' ? 'error' : 'pending processing';
    const summary = meeting.summary;
    const date = formatDate(meeting.added_at);
    const isCloud = meeting.source !== 'Загружено вручную';
    const sourceLabel = meeting.source === 'Из облака (API)' ? 'API Яндекс-диск' : isCloud ? 'Яндекс Диск' : 'Файл с компьютера';
    const retryClass = meeting.source === 'Из облака (API)' ? 'retry-yandex-api' : 'retry-cloud';
    return `<article class="meeting-row" data-id="${escapeHtml(meeting.id)}"><button class="meeting-summary" type="button" aria-expanded="false"><span class="meeting-title-wrap"><span class="meeting-file-icon">${icon}</span><span class="meeting-title-text"><strong title="${escapeHtml(meeting.file_name)}">${escapeHtml(meeting.file_name)}</strong><small>${escapeHtml(meeting.source)}${date ? ` · ${escapeHtml(date)}` : ''}</small></span></span><span class="meeting-source">${escapeHtml(sourceLabel)}</span><span class="meeting-status ${statusClass}"><i class="status-dot"></i>${escapeHtml(status)}</span><span class="meeting-toggle"><svg viewBox="0 0 20 20" fill="none"><path d="m5.5 7.5 4.5 4.5 4.5-4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span></button><div class="meeting-details" hidden>${meeting.status === 'error' ? `<p class="meeting-error">${escapeHtml(meeting.error || 'Не удалось обработать запись.')}</p>${isCloud ? `<button class="retry-button ${retryClass}" type="button">Повторить</button>` : '<button class="retry-button retry-local" type="button">Повторить загрузку</button><input class="retry-file-input" type="file" accept="video/mp4,video/webm,.mp4,.webm">'}` : meeting.status !== 'done' ? '<p class="detail-summary">Запись обрабатывается. Результат появится здесь автоматически.</p>' : `<p class="detail-summary">${escapeHtml(summary?.summary || '')}</p><div class="detail-grid">${itemList(summary?.decisions, 'РЕШЕНИЯ')}${itemList(summary?.tasks, 'ЗАДАЧИ')}${itemList(summary?.open_questions, 'ОТКРЫТЫЕ ВОПРОСЫ')}</div>${meeting.transcript ? `<div class="transcript-block"><details><summary>Показать полную расшифровку</summary><div class="transcript-text">${escapeHtml(meeting.transcript)}</div></details></div>` : ''}`}</div></article>`;
  }).join('');

  document.querySelectorAll('.meeting-summary').forEach((button) => {
    const row = button.closest('.meeting-row');
    const savedState = disclosureStates.get(row.dataset.id);
    if (savedState?.expanded) {
      const details = row.querySelector('.meeting-details');
      details.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      row.classList.add('expanded');
    }
    row.querySelectorAll('details').forEach((disclosure, index) => {
      disclosure.open = savedState?.nested[index] ?? false;
    });
    button.addEventListener('click', () => {
      const details = row.querySelector('.meeting-details');
      const open = details.hidden;
      details.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      row.classList.toggle('expanded', open);
    });
  });
  document.querySelectorAll('.retry-cloud').forEach((button) => button.addEventListener('click', () => retryCloud(button.closest('.meeting-row').dataset.id)));
  document.querySelectorAll('.retry-yandex-api').forEach((button) => button.addEventListener('click', () => retryCloud(button.closest('.meeting-row').dataset.id, true)));
  document.querySelectorAll('.retry-local').forEach((button) => button.addEventListener('click', () => button.nextElementSibling.click()));
  document.querySelectorAll('.retry-file-input').forEach((input) => input.addEventListener('change', () => {
    if (input.files[0]) retryLocal(input.closest('.meeting-row').dataset.id, input.files[0]);
  }));
}

async function refresh() {
  try {
    const response = await fetch('/api/meetings');
    if (!response.ok) throw new Error();
    const latest = await response.json();
    const unchanged = JSON.stringify(latest) === JSON.stringify(meetings);
    for (const meeting of latest) {
      const old = knownStatuses.get(meeting.id);
      if (old && old !== meeting.status && meeting.status === 'done') notify(`«${meeting.file_name}» — конспект готов`);
      if (old && old !== meeting.status && meeting.status === 'error') notify(meeting.error || 'Не удалось обработать запись');
      knownStatuses.set(meeting.id, meeting.status);
    }
    meetings = latest;
    if (!unchanged) render();
  } catch { notify('Не удалось подключиться к серверу. Обновите страницу позже.'); }
}

async function sendFile(endpoint, file) {
  const data = new FormData();
  data.append('video', file);
  const response = await fetch(endpoint, { method: 'POST', body: data });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Не удалось загрузить видео');
  return body;
}

async function checkBrowserVideo(file) {
  const extension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
  if (!['.mp4', '.webm'].includes(extension)) throw new Error('Поддерживаются только файлы WebM и MP4');
  const video = document.createElement('video');
  const url = URL.createObjectURL(file);
  try {
    const duration = await new Promise((resolve, reject) => {
      video.preload = 'metadata';
      video.onloadedmetadata = () => resolve(video.duration);
      video.onerror = () => reject(new Error('Не удалось прочитать видео. Проверьте файл и загрузите его ещё раз.'));
      video.src = url;
    });
    if (!Number.isFinite(duration) || duration > 600) throw new Error('Запись слишком длинная. Максимум — 10 минут');
  } finally { URL.revokeObjectURL(url); }
}

async function uploadVideo(file, endpoint = '/api/upload') {
  if (!file) return;
  try {
    if (file.size > 250 * 1024 * 1024) throw new Error('Файл слишком большой. Максимальный размер — 250 МБ');
    await checkBrowserVideo(file);
    await sendFile(endpoint, file);
    notify('Запись добавлена. Анализ уже начался.');
    await refresh();
  } catch (error) { notify(error.message); }
}

async function retryLocal(id, file) { await uploadVideo(file, `/api/retry/${encodeURIComponent(id)}`); }

async function retryCloud(id, apiImport = false) {
  try {
    const response = await fetch(`/api/retry/${encodeURIComponent(id)}`, { method: 'POST' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Не удалось повторить загрузку');
    notify(body.reused ? `Эта версия записи уже есть в архиве: «${body.file_name}»` : 'Обработка записи запущена повторно.');
    await refresh();
  } catch (error) { notify(error.message); }
}

videoInput.addEventListener('change', () => {
  if (videoInput.files[0]) uploadVideo(videoInput.files[0]);
  videoInput.value = '';
});

for (const event of ['dragenter', 'dragover']) dropZone.addEventListener(event, (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
for (const event of ['dragleave', 'drop']) dropZone.addEventListener(event, (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); });
dropZone.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) uploadVideo(e.dataTransfer.files[0]); });

document.querySelector('#cloudForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.querySelector('#cloudUrl');
  const form = event.currentTarget;
  const submitButtons = [...form.querySelectorAll('[type="submit"]')];
  const note = form.querySelector('.cloud-note');
  const previousNote = note.textContent;
  submitButtons.forEach((button) => { button.disabled = true; });
  note.textContent = 'Проверяю ссылку и загружаю файл с Яндекс Диска…';
  try {
    const response = await fetch('/api/cloud', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: input.value.trim() }) });
    const meeting = await response.json();
    if (!response.ok) throw new Error(meeting.error || 'Не удалось добавить файл из облака');
    input.value = '';
    notify(meeting.reused ? `Эта версия записи уже есть в архиве: «${meeting.file_name}»` : 'Запись добавлена из облака. Анализ уже начался.');
    await refresh();
    document.querySelector('#meetings').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { notify(error.message); }
  finally {
    submitButtons.forEach((button) => { button.disabled = false; });
    note.textContent = previousNote;
  }
});

document.querySelector('#refreshButton').addEventListener('click', refresh);
document.querySelector('#yandexPoll').addEventListener('click', async () => {
  const button = document.querySelector('#yandexPoll');
  button.disabled = true;
  try {
    const response = await fetch('/api/yandex/poll', { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не удалось проверить папку');
    notify('Проверка папки запущена. Результаты появятся здесь автоматически.');
    await refreshYandexStatus();
  } catch (error) { notify(error.message); }
  finally { await refreshYandexStatus(); }
});
document.querySelector('#yandexDisconnect').addEventListener('click', async () => {
  try {
    await fetch('/api/yandex/disconnect', { method: 'POST' });
    notify('Яндекс Диск отключён.');
    await refreshYandexStatus();
  } catch { notify('Не удалось отключить Яндекс Диск.'); }
});

const yandexResult = new URLSearchParams(location.search).get('yandex');
if (yandexResult === 'connected') notify('Яндекс Диск подключён. Запущена первая проверка папки.');
if (yandexResult === 'error') notify('Не удалось подключить Яндекс Диск. Проверьте настройки OAuth.');
if (yandexResult) history.replaceState({}, '', location.pathname);
refresh();
refreshYandexStatus();
setInterval(refresh, 2500);
setInterval(refreshYandexStatus, 2500);
