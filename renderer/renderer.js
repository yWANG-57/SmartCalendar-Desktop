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

const titlebarHotkey = document.getElementById('titlebar-hotkey');
const hotkeyInput    = document.getElementById('hotkey-input');
const hotkeyResetBtn = document.getElementById('hotkey-reset-btn');
const hotkeyHint     = document.getElementById('hotkey-hint');

const editTitle       = document.getElementById('edit-title');
const editStart       = document.getElementById('edit-start');
const editEnd         = document.getElementById('edit-end');
const editLocation    = document.getElementById('edit-location');
const editReminder    = document.getElementById('edit-reminder');
const editDescription = document.getElementById('edit-description');

// ─── Utility ───────────────────────────────────────────────────────────────────

// Electron 会把 ipcMain.handle 抛出的错误包装成
// "Error invoking remote method 'settings:saveGeminiKey': Error: <真正的消息>"，
// 直接展示会把用户该看的那句话淹没在前缀里。
function cleanErr(err, fallback) {
  const raw = String((err && err.message) || err || '');
  const i = raw.lastIndexOf('Error: ');
  const msg = (i >= 0 ? raw.slice(i + 7) : raw).trim();
  return msg || fallback;
}

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

// ─── Global hotkey ─────────────────────────────────────────────────────────────

const IS_MAC = api.platform === 'darwin';

// Electron accelerator -> 给人看的写法
function prettyAccelerator(acc) {
  if (!acc) return '未启用';
  const s = acc.replace(/CommandOrControl|CmdOrCtrl/g, IS_MAC ? 'Command' : 'Ctrl');
  if (!IS_MAC) return s.replace(/Command/g, 'Win');
  return s
    .replace(/Command/g, '\u2318')
    .replace(/Control|Ctrl/g, '\u2303')
    .replace(/Option|Alt/g, '\u2325')
    .replace(/Shift/g, '\u21e7')
    .replace(/\+/g, '');
}

// 用 e.code（物理键位）而非 e.key，避免德语等布局下拿到 "ß" 这类无法注册的字符
function keyFromEvent(e) {
  const code = e.code || '';
  if (/^Key[A-Z]$/.test(code))   return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  const named = {
    Space: 'Space', Enter: 'Return', Backquote: '`', Minus: '-', Equal: '=',
    BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
    Quote: "'", Comma: ',', Period: '.', Slash: '/',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  };
  return named[code] || null;
}

function acceleratorFromEvent(e) {
  const mods = [];
  if (e.metaKey)  mods.push('Command');
  if (e.ctrlKey)  mods.push('Control');
  if (e.altKey)   mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');

  const key = keyFromEvent(e);
  if (!key) return null;          // 只按下了修饰键，继续等
  if (!mods.length) return null;  // 不带修饰键会抢掉全系统的普通打字，必须拒绝
  return [...mods, key].join('+');
}

// 已知的高风险组合。冲突检测基本指望不上：register() 检测不到「某个前台应用
// 内部用了这个键」，而在 macOS 上连「已被其他应用全局注册」都检测不到（实测
// 两个应用注册同一组合都会返回 true，冲突是静默失败）。所以只能硬编码提醒。
function riskyAccelerator(acc) {
  const a = acc.toLowerCase();
  if (IS_MAC) {
    if (a.includes('control') && a.includes('space')) return '这是 macOS 的输入法切换键，占用后中英文切换会失效。';
    if (a.includes('command') && a.includes('space')) return '这是 Spotlight 的快捷键。';
    if (a.includes('command') && !a.includes('alt') && !a.includes('control')) {
      return 'Command 加单个字母会让全系统所有应用的同名功能失灵，建议再加一个 Option 或 Control。';
    }
  } else if (a.includes('control') && a.includes('alt') && !a.includes('shift')) {
    return '在德语/波兰语等键盘布局上 Ctrl+Alt 等同于 AltGr，可能影响 @ € ł ś 等字符的输入。';
  }
  return '';
}

// 有已解析未保存的内容、或设置面板展开时，阻止主进程的失焦自动隐藏
function updatePinned() {
  const hasDraft = !saveBtn.disabled;
  api.window.setPinned(hasDraft || settingsPanel.hasAttribute('open'));
}

function setHotkeyHint(text, kind) {
  hotkeyHint.textContent = text;
  hotkeyHint.className = 'key-hint' + (kind ? ` key-hint-${kind}` : '');
}

function renderHotkey(info, warn) {
  if (!info) return;
  const { active, saved } = info;

  hotkeyInput.value = prettyAccelerator(saved || active);
  titlebarHotkey.textContent = active ? prettyAccelerator(active) : '热键未启用';
  textarea.placeholder = active
    ? `复制任意文字后按 ${prettyAccelerator(active)}，此处会自动填入...`
    : '复制任意文字后点击托盘图标，此处会自动填入...';

  if (!active) {
    setHotkeyHint('注册失败：候选组合都被其他程序占用。请换一个组合，或直接点击托盘图标使用。', 'warn');
  } else if (saved && active !== saved) {
    setHotkeyHint(`${prettyAccelerator(saved)} 已被占用，已自动降级为 ${prettyAccelerator(active)}。`, 'warn');
  } else if (warn) {
    setHotkeyHint(`已生效，但请注意：${warn}`, 'warn');
  } else {
    setHotkeyHint(`当前生效：${prettyAccelerator(active)}`, 'ok');
  }
}

async function captureHotkey(e) {
  e.preventDefault();
  const accelerator = acceleratorFromEvent(e);
  if (!accelerator) {
    setHotkeyHint(IS_MAC
      ? '需要至少一个修饰键（\u2318 \u2303 \u2325 \u21e7）加一个普通键'
      : '需要至少一个修饰键（Ctrl / Alt / Shift）加一个普通键', 'warn');
    return;
  }
  const info = await api.settings.setHotkey(accelerator);
  renderHotkey(info, riskyAccelerator(accelerator));
}

async function resetHotkey() {
  const info = await api.settings.setHotkey('');   // 空值 -> 主进程回落到默认值
  renderHotkey(info, '');
}

// ─── Settings ──────────────────────────────────────────────────────────────────

async function loadSettings() {
  const status = await api.settings.getStatus();

  applyStatus(status);
  updateAuthUI(status.hasGoogleAuth);

  // Show placeholder hints for already-configured keys
  if (status.hasGeminiKey) apiKeyInput.placeholder = '••••••（已配置，留空则保持不变）';
  if (status.hasGoogleAuth) clientIdInput.placeholder = '••••••（已配置，留空则保持不变）';

  if (!status.hasGeminiKey || !status.hasGoogleAuth || !status.secureStorageOk) {
    settingsPanel.setAttribute('open', '');
  }
}

// 凭据存在但读不出来，和从没配过，是两种完全不同的处境：
// 前者要去修钥匙串授权，后者才是去填 API Key。混成一句提示会把人带偏。
function applyStatus(status) {
  if (!status.secureStorageOk) {
    settingsStatus.textContent = '钥匙串访问失败';
    settingsStatus.className = 'settings-status-text status-warn';
    showError(status.secureStorageError);
    return;
  }
  updateSettingsStatus(status.hasGeminiKey, status.hasGoogleAuth);
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
  try {
    await api.settings.saveGeminiKey(key);
  } catch (err) {
    // 加密不可用时主进程会抛错而不是明文落盘，这里必须让用户看见
    showError(cleanErr(err, '保存 API Key 失败'));
    return;
  }
  apiKeyInput.value = '';
  apiKeyInput.placeholder = '••••••（已配置，留空则保持不变）';
  applyStatus(await api.settings.getStatus());
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
  try {
    await api.settings.saveGoogleCreds(clientId, secret);
  } catch (err) {
    showError(cleanErr(err, '保存 Google 凭据失败'));
    return;
  }
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
    applyStatus(status);
    authHint.textContent = 'Google 账户已成功连接！';
    authHint.className = 'key-hint key-hint-ok';
    settingsPanel.removeAttribute('open');
  } catch (err) {
    authHint.textContent = cleanErr(err, '授权失败');
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
  renderHotkey(await api.settings.getHotkey(), '');
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
  if (!status.secureStorageOk) {
    showError(status.secureStorageError);
    settingsPanel.setAttribute('open', '');
    return;
  }
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
    updatePinned();
    showSuccess('解析成功，可以修改后保存。');
  } catch (err) {
    console.error(err);
    showError(cleanErr(err, '解析出现未知错误'));
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
    updatePinned();   // saveBtn 已禁用 -> 解除 pin，窗口可以正常失焦隐藏
    showSuccess('已成功保存到 Google Calendar！');
    api.notify('SmartCalendar', `"${summary}" 已添加到 Google Calendar`);

    setTimeout(() => api.window.hide(), 2500);
  } catch (err) {
    console.error(err);
    showError(cleanErr(err, '保存时发生错误'));
    saveBtn.disabled = false;
    updatePinned();   // 保存失败，内容仍未落库，继续 pin 住
  } finally {
    saveBtn.textContent = 'Save to Calendar';
  }
}

// ─── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();

  // 初次读取 + 后续主进程主动推送（降级/失败时会推）
  api.settings.getHotkey().then((info) => renderHotkey(info, ''));
  api.onHotkeyChanged((info) => renderHotkey(info, ''));

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
    updatePinned();
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

  settingsPanel.addEventListener('toggle', updatePinned);
  updatePinned();

  hotkeyInput.addEventListener('keydown', captureHotkey);
  hotkeyResetBtn.addEventListener('click', resetHotkey);

  clearDataBtn.addEventListener('click', clearAllData);
});
