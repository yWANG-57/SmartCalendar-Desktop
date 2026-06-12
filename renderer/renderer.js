// renderer.js — SmartCalendar Desktop renderer process

const api = window.electronAPI;

// ─── DOM refs ──────────────────────────────────────────────────────────────────

const textarea      = document.getElementById('input-text');
const analyzeBtn    = document.getElementById('analyze-btn');
const saveBtn       = document.getElementById('save-btn');
const closeBtn      = document.getElementById('close-btn');
const errorBanner   = document.getElementById('error-banner');
const successBanner = document.getElementById('success-banner');
const cardStatus    = document.getElementById('card-status');

const settingsPanel  = document.getElementById('settings-panel');
const settingsStatus = document.getElementById('settings-status');
const apiKeyInput    = document.getElementById('api-key-input');
const saveKeyBtn     = document.getElementById('save-key-btn');
const clientIdInput  = document.getElementById('client-id-input');
const clientSecretInput = document.getElementById('client-secret-input');
const saveCredsBtn   = document.getElementById('save-creds-btn');
const authBtn        = document.getElementById('auth-btn');
const authDot        = document.getElementById('auth-status');
const authLabel      = document.getElementById('auth-label');
const authHint       = document.getElementById('auth-hint');

const clipboardBanner       = document.getElementById('clipboard-banner');
const clipboardAcceptBtn    = document.getElementById('clipboard-accept');
const clipboardDeclineBtn   = document.getElementById('clipboard-decline');

const clearDataBtn = document.getElementById('clear-data-btn');

const editTitle       = document.getElementById('edit-title');
const editStart       = document.getElementById('edit-start');
const editEnd         = document.getElementById('edit-end');
const editLocation    = document.getElementById('edit-location');
const editReminder    = document.getElementById('edit-reminder');
const editDescription = document.getElementById('edit-description');

// ─── Utility ───────────────────────────────────────────────────────────────────

function showError(msg) {
  if (!msg) { errorBanner.classList.add('hidden'); return; }
  errorBanner.textContent = msg;
  errorBanner.classList.remove('hidden');
  successBanner.classList.add('hidden');
}

function showSuccess(msg) {
  if (!msg) { successBanner.classList.add('hidden'); return; }
  successBanner.innerHTML = `<span class="success-pulse"></span><span>${msg}</span>`;
  successBanner.classList.remove('hidden');
  errorBanner.classList.add('hidden');
}

function isoToLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function localToISO(dt) {
  if (!dt) return '';
  return new Date(dt).toISOString();
}

// ─── Settings ──────────────────────────────────────────────────────────────────

async function loadSettings() {
  const status = await api.settings.getStatus();

  updateSettingsStatus(status.hasGeminiKey, status.hasGoogleAuth);
  updateAuthUI(status.hasGoogleAuth);

  // Show placeholder hints for already-configured keys
  if (status.hasGeminiKey) apiKeyInput.placeholder = '••••••（已配置，留空则保持不变）';
  if (status.hasGoogleAuth) clientIdInput.placeholder = '••••••（已配置，留空则保持不变）';

  if (!status.hasGeminiKey || !status.hasGoogleAuth) {
    settingsPanel.setAttribute('open', '');
  }
}

function updateSettingsStatus(hasKey, hasAuth) {
  const issues = [];
  if (!hasKey)  issues.push('需配置 API Key');
  if (!hasAuth) issues.push('需连接 Google');
  settingsStatus.textContent = issues.length ? issues.join(' · ') : '已就绪';
  settingsStatus.className = 'settings-status-text ' +
    (issues.length ? 'status-warn' : 'status-ok');
}

function updateAuthUI(connected) {
  authDot.className   = `auth-dot ${connected ? 'auth-dot-ok' : 'auth-dot-idle'}`;
  authLabel.textContent = connected ? '已连接 Google' : '未连接 Google';
  authBtn.textContent = connected ? '重新授权' : '连接账户';
}

async function saveApiKey() {
  const key = apiKeyInput.value.trim();
  if (!key) {
    const status = await api.settings.getStatus();
    if (status.hasGeminiKey) { showSuccess('API Key 未更改（已有配置）。'); return; }
    showError('请输入有效的 Gemini API Key');
    return;
  }
  await api.settings.saveGeminiKey(key);
  apiKeyInput.value = '';
  apiKeyInput.placeholder = '••••••（已配置，留空则保持不变）';
  const status = await api.settings.getStatus();
  updateSettingsStatus(status.hasGeminiKey, status.hasGoogleAuth);
  showSuccess('Gemini API Key 已安全保存');
}

async function saveCredentials() {
  const clientId = clientIdInput.value.trim();
  if (!clientId) {
    const status = await api.settings.getStatus();
    if (status.hasGoogleAuth) { showSuccess('Google 凭据未更改（已有配置）。'); return; }
    showError('请输入 Google Client ID');
    return;
  }
  const secret = clientSecretInput.value.trim();
  await api.settings.saveGoogleCreds(clientId, secret);
  clientIdInput.value = '';
  clientIdInput.placeholder = '••••••（已配置，留空则保持不变）';
  clientSecretInput.value = '';
  showSuccess('Google 凭据已安全保存，请点击"连接账户"完成授权。');
}

async function connectGoogle() {
  authBtn.disabled = true;
  authHint.textContent = '浏览器将打开 Google 授权页...';
  authHint.className = 'key-hint';

  try {
    await api.auth.google();
    updateAuthUI(true);
    const status = await api.settings.getStatus();
    updateSettingsStatus(status.hasGeminiKey, true);
    authHint.textContent = 'Google 账户已成功连接！';
    authHint.className = 'key-hint key-hint-ok';
    settingsPanel.removeAttribute('open');
  } catch (err) {
    authHint.textContent = err.message;
    authHint.className = 'key-hint key-hint-warn';
    updateAuthUI(false);
  } finally {
    authBtn.disabled = false;
  }
}

// ─── Clipboard consent ────────────────────────────────────────────────────────

function showClipboardBanner() {
  clipboardBanner.classList.remove('hidden');
}

async function acceptClipboard() {
  await api.settings.setClipboardConsent(true);
  clipboardBanner.classList.add('hidden');
  showSuccess('已开启剪贴板自动读取。');
}

function declineClipboard() {
  clipboardBanner.classList.add('hidden');
}

// ─── Clear all data ───────────────────────────────────────────────────────────

async function clearAllData() {
  await api.settings.clearAll();
  apiKeyInput.value = '';
  clientIdInput.value = '';
  clientSecretInput.value = '';
  updateSettingsStatus(false, false);
  updateAuthUI(false);
  settingsPanel.setAttribute('open', '');
  showSuccess('所有数据已清除。');
}

// ─── Analyze text (via main process) ─────────────────────────────────────────

async function analyzeText() {
  showError('');
  showSuccess('');
  saveBtn.disabled = true;

  const inputText = textarea.value.trim();
  if (!inputText) {
    showError('请输入或复制一些文本后再点击 Analyze。');
    return;
  }

  const status = await api.settings.getStatus();
  if (!status.hasGeminiKey) {
    showError('请先在设置中配置 Gemini API Key。');
    settingsPanel.setAttribute('open', '');
    return;
  }

  analyzeBtn.disabled = true;
  analyzeBtn.textContent = 'Analyzing...';
  cardStatus.textContent = '解析中...';
  cardStatus.style.color = '';

  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const parsed = await api.api.analyze(inputText, timezone);

    const now = new Date();
    const fallbackStart = now.toISOString();
    const fallbackEnd   = new Date(now.getTime() + 3_600_000).toISOString();

    editTitle.value       = parsed.summary  || 'New Event';
    editStart.value       = isoToLocal(parsed.start || fallbackStart);
    editEnd.value         = isoToLocal(parsed.end   || fallbackEnd);
    editLocation.value    = parsed.location || '';
    editReminder.value    = Number.isInteger(parsed.reminder_minutes) ? parsed.reminder_minutes : 10;
    editDescription.value = parsed.description || inputText;

    cardStatus.textContent = '已解析';
    cardStatus.style.color = '#22c55e';
    saveBtn.disabled = false;
    showSuccess('解析成功，可以修改后保存。');
  } catch (err) {
    console.error(err);
    showError(err.message || '解析出现未知错误');
    cardStatus.textContent = '解析失败';
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Analyze';
  }
}

// ─── Save to Google Calendar (via main process) ──────────────────────────────

async function saveToCalendar() {
  showError('');
  showSuccess('');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    const startISO = localToISO(editStart.value);
    const endISO   = localToISO(editEnd.value);
    if (!startISO || !endISO) throw new Error('请填写有效的开始和结束时间。');

    const summary = editTitle.value.trim() || 'New Event';

    const payload = {
      summary,
      description: editDescription.value.trim(),
      start: { dateTime: startISO, timeZone },
      end:   { dateTime: endISO,   timeZone },
      reminders: {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: parseInt(editReminder.value) || 10 }],
      },
    };
    const loc = editLocation.value.trim();
    if (loc) payload.location = loc;

    await api.api.createEvent(payload);

    cardStatus.textContent = '已保存';
    cardStatus.style.color = '#22c55e';
    showSuccess('已成功保存到 Google Calendar！');
    api.notify('SmartCalendar', `"${summary}" 已添加到 Google Calendar`);

    setTimeout(() => api.window.hide(), 2500);
  } catch (err) {
    console.error(err);
    showError(err.message || '保存时发生错误');
    saveBtn.disabled = false;
  } finally {
    saveBtn.textContent = 'Save to Calendar';
  }
}

// ─── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();

  api.onShow((text) => {
    textarea.value = text || '';
    showError('');
    showSuccess('');
    cardStatus.textContent = '未解析';
    cardStatus.style.color = '';
    saveBtn.disabled = true;
    editTitle.value = '';
    editStart.value = '';
    editEnd.value = '';
    editLocation.value = '';
    editReminder.value = '10';
    editDescription.value = '';
  });

  api.onClipboardConsentNeeded(() => {
    showClipboardBanner();
  });

  closeBtn.addEventListener('click',    () => api.window.hide());
  saveKeyBtn.addEventListener('click',  saveApiKey);
  saveCredsBtn.addEventListener('click', saveCredentials);
  authBtn.addEventListener('click',     connectGoogle);
  analyzeBtn.addEventListener('click',  analyzeText);
  saveBtn.addEventListener('click',     saveToCalendar);

  clipboardAcceptBtn.addEventListener('click',  acceptClipboard);
  clipboardDeclineBtn.addEventListener('click', declineClipboard);

  clearDataBtn.addEventListener('click', clearAllData);
});
