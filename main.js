// main.js — SmartCalendar Desktop (Electron main process)

const {
  app,
  BrowserWindow,
  globalShortcut,
  Tray,
  Menu,
  clipboard,
  ipcMain,
  shell,
  Notification,
  nativeImage,
  screen,
  safeStorage,
  session,
} = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

const isMac = process.platform === 'darwin';

// ─── Encrypted persistent store ──────────────────────────────────────────────

const SECURE_KEYS = new Set([
  'geminiApiKey',
  'googleClientId',
  'googleClientSecret',
  'googleAccessToken',
  'googleRefreshToken',
]);

// 钥匙串不可用时给用户看的说明。三大平台的成因不同，但用户要做的事一样：
// 重启应用，在系统弹出的授权框里选择「始终允许」。
const SECURE_STORAGE_HINT =
  process.platform === 'darwin'
    ? '系统钥匙串访问被拒绝或不可用。请退出并重新打开 SmartCalendar，在弹出的钥匙串提示中选择「始终允许」。'
    : '系统凭据存储当前不可用，无法安全读写密钥。请重启 SmartCalendar 后重试。';

class Store {
  constructor() {
    this._path = null;
    this._data = {};
    // 记录哪些密钥「存在但解不开」—— 这和「从未配置过」是完全不同的状态，
    // 混为一谈会让用户以为配置丢了，从而反复重填一个根本存不进去的值。
    this._undecryptable = new Set();
  }

  init() {
    this._path = path.join(app.getPath('userData'), 'config.json');
    try {
      if (fs.existsSync(this._path)) {
        this._data = JSON.parse(fs.readFileSync(this._path, 'utf8'));
      }
    } catch (e) {
      console.error('[SmartCalendar] 读取 config.json 失败:', e.message);
    }
    this._migrateSecureKeys();
    this.verifySecureKeys();   // 启动即暴露问题，而不是等用户点到某个功能
  }

  // isEncryptionAvailable() 本身在钥匙串被拒时也可能抛异常，不能裸调
  _encryptionAvailable() {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch (e) {
      console.error('[SmartCalendar] safeStorage 不可用:', e.message);
      return false;
    }
  }

  _migrateSecureKeys() {
    if (!this._encryptionAvailable()) return;
    let changed = false;
    for (const key of SECURE_KEYS) {
      const raw = this._data[key];
      if (typeof raw === 'string' && raw && !raw.startsWith('enc:')) {
        try {
          const encrypted = safeStorage.encryptString(raw);
          this._data[key] = 'enc:' + encrypted.toString('base64');
          changed = true;
        } catch (e) {
          console.error(`[SmartCalendar] 迁移 ${key} 到加密存储失败:`, e.message);
        }
      }
    }
    if (changed) this._save();
  }

  _save() {
    try {
      fs.writeFileSync(this._path, JSON.stringify(this._data, null, 2), 'utf8');
    } catch (e) {
      console.error('[SmartCalendar] 写入 config.json 失败:', e.message);
    }
  }

  // 某个键是否「配置过」—— 不做解密，因此钥匙串不可用时依然准确。
  // 用它回答「要不要提示用户去配置」，而不是用 get() 的返回值。
  has(key) {
    const raw = this._data[key];
    return typeof raw === 'string' ? raw.length > 0 : raw != null;
  }

  get(key, defaultVal = undefined) {
    const raw = key in this._data ? this._data[key] : undefined;
    if (raw === undefined) return defaultVal;
    if (SECURE_KEYS.has(key) && typeof raw === 'string' && raw.startsWith('enc:')) {
      try {
        const buf = Buffer.from(raw.slice(4), 'base64');
        const value = safeStorage.decryptString(buf);
        this._undecryptable.delete(key);
        return value;
      } catch (e) {
        // 钥匙串被拒绝、条目被删除、或应用签名变化都会走到这里。
        // 数据还在磁盘上，只是此刻读不出来 —— 必须记下来，让上层能把
        // 「读不出来」和「没配过」区分开并给出可操作的提示。
        this._undecryptable.add(key);
        console.error(`[SmartCalendar] 解密 ${key} 失败:`, e.message);
        return defaultVal;
      }
    }
    return raw;
  }

  set(key, value) {
    if (SECURE_KEYS.has(key)) {
      let encrypted;
      try {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('encryption unavailable');
        encrypted = safeStorage.encryptString(String(value));
      } catch (e) {
        // 关键：加密不可用时绝不能退化成明文落盘。原实现在这种情况下会把
        // API Key 和 refresh token 直接明文写进 config.json。
        console.error(`[SmartCalendar] 加密 ${key} 失败:`, e.message);
        throw new Error(SECURE_STORAGE_HINT);
      }
      this._data[key] = 'enc:' + encrypted.toString('base64');
      this._undecryptable.delete(key);
    } else {
      this._data[key] = value;
    }
    this._save();
  }

  delete(key) {
    delete this._data[key];
    this._undecryptable.delete(key);
    this._save();
  }

  clearAll() {
    this._data = {};
    this._undecryptable.clear();
    this._save();
  }

  // 主动校验所有已保存的密钥能否解开。
  // 必须主动做：get() 只在真正取用时才会发现问题，而 has() 根本不解密 ——
  // 若只等 get() 触发，设置面板会在凭据其实读不出来时显示「已就绪」，
  // 用户要一直点到 Analyze 才撞上错误。
  verifySecureKeys() {
    for (const key of SECURE_KEYS) {
      const raw = this._data[key];
      if (typeof raw === 'string' && raw.startsWith('enc:')) {
        this.get(key);   // get() 内部维护 _undecryptable，成功时会自动清除
      }
    }
  }

  // 供 UI 展示：加密后端是否可用，以及哪些已保存的密钥当前读不出来
  secureStatus() {
    this.verifySecureKeys();
    const undecryptable = [...this._undecryptable];
    const available = this._encryptionAvailable();
    return {
      ok: available && undecryptable.length === 0,
      undecryptable,
      message: available && undecryptable.length === 0 ? null : SECURE_STORAGE_HINT,
    };
  }
}

const store = new Store();

// ─── HTTPS helpers ────────────────────────────────────────────────────────────

function httpsPost(url, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOpts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    const req = https.request(reqOpts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ─── OAuth2 constants ─────────────────────────────────────────────────────────

const OAUTH_PORT = 9823;
const REDIRECT_URI = `http://localhost:${OAUTH_PORT}/oauth2callback`;
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// ─── Window management ───────────────────────────────────────────────────────

let mainWindow = null;
let tray = null;
let authServer = null;
let activeHotkey = null;
let isAuthing = false;
let isPinned = false;   // 有未保存内容 / 设置面板展开时，禁止失焦自动隐藏

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 800,
    show: false,
    frame: false,
    resizable: true,
    minWidth: 380,
    minHeight: 500,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // CSP: renderer cannot make any external network requests
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'none'",
        ],
      },
    });
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // macOS: 让窗口在全屏应用之上也能被热键唤出（菜单栏工具的标配行为）
  if (isMac) {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  // 失焦自动隐藏。OAuth 期间浏览器会抢走焦点，此时必须保持窗口存活，
  // 否则用户看不到授权成功/失败的反馈。
  mainWindow.on('blur', () => {
    if (isAuthing) return;
    // showWindow() 每次都会让渲染层清空预览字段，所以在有未保存内容时自动隐藏
    // 会导致用户编辑到一半的事件被清掉。
    if (isPinned) return;
    if (mainWindow.webContents.isDevToolsOpened()) return;
    mainWindow.hide();
  });
}

function positionWindow() {
  if (!tray || !mainWindow) return;
  const trayBounds = tray.getBounds();
  const winBounds = mainWindow.getBounds();
  const display = screen.getDisplayMatching(trayBounds);
  const wa = display.workArea;

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2);
  let y = trayBounds.y > wa.y + wa.height / 2
    ? trayBounds.y - winBounds.height - 4
    : trayBounds.y + trayBounds.height + 4;

  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - winBounds.width));
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - winBounds.height));
  mainWindow.setPosition(x, y);
}

function showWindow() {
  if (!mainWindow) return;
  positionWindow();
  mainWindow.show();
  mainWindow.focus();

  const hasConsent = !!store.get('clipboardConsent');
  if (hasConsent) {
    const clipText = clipboard.readText().trim();
    mainWindow.webContents.send('show-with-text', clipText);
  } else {
    mainWindow.webContents.send('show-with-text', '');
    mainWindow.webContents.send('clipboard-consent-needed');
  }
}

// ─── Global hotkey ───────────────────────────────────────────────────────────
//
// 全局热键是抢占式的：注册成功后，该组合在所有应用中都会被本应用拦截。
// 因此这里遵循三条原则：
//   1) 默认值只负责「装上就能用」，用户必须能改；
//   2) 注册结果必须能反馈到 UI，否则用户只会看到「按了没反应」；
//   3) 托盘点击始终是兜底入口 —— 热键全部失败时不能让应用没有入口。
//
// 选值避坑记录：
//   - Ctrl+Alt+<字母> 在欧洲键盘布局上等价于 AltGr+<字母>，会抢掉 @ € ł ś 等字符输入
//   - macOS 的 Ctrl+Space / Ctrl+Alt+Space 是输入法切换，抢了会导致中英文切换失效
//   - Cmd+<单字母> 会让全系统所有应用的同名功能失灵（如 Cmd+Shift+S 的「另存为」）
//   - Fn / 地球仪键无法作为 Electron accelerator 的修饰键，不要考虑

// CommandOrControl 会自动展开为 macOS 的 ⌘⌥S 和 Windows 的 Ctrl+Alt+S
const DEFAULT_HOTKEY = 'CommandOrControl+Alt+S';

const FALLBACK_HOTKEYS = isMac
  ? ['Command+Alt+K', 'Control+Alt+S']
  : ['Alt+Shift+S', 'Ctrl+Alt+K'];

function broadcastHotkey(requested) {
  mainWindow?.webContents.send('hotkey:changed', {
    active: activeHotkey,
    saved: requested ?? null,
  });
}

function applyHotkey(preferred) {
  globalShortcut.unregisterAll();

  for (const accelerator of [preferred, ...FALLBACK_HOTKEYS].filter(Boolean)) {
    try {
      // register() 对非法的 accelerator 字符串会直接抛异常 —— 开放用户
      // 自定义后不 catch 会崩掉主进程。
      //
      // 关于返回值：Windows 上 RegisterHotKey 是独占的，被占用会返回 false，
      // 下面的降级链能正常生效。但 macOS 上实测（两个 Electron 应用注册同一
      // 组合）register() 依然返回 true —— 系统不让应用互相抢夺全局热键，冲突
      // 是「静默失败」而非报错。所以在 macOS 上不能指望自动降级，真正的兜底
      // 是「用户可自行更换热键」+「托盘点击始终可用」。
      if (globalShortcut.register(accelerator, showWindow)) {
        activeHotkey = accelerator;
        tray?.setToolTip(`SmartCalendar — ${accelerator}`);
        console.log(`[SmartCalendar] 热键已注册: ${accelerator}`);
        broadcastHotkey(preferred);
        return accelerator;
      }
      console.warn(`[SmartCalendar] 热键被占用: ${accelerator}`);
    } catch (e) {
      console.warn(`[SmartCalendar] 无效的热键 "${accelerator}": ${e.message}`);
    }
  }

  activeHotkey = null;
  tray?.setToolTip('SmartCalendar — 热键未启用，请点击图标');
  console.warn('[SmartCalendar] 所有候选热键均注册失败');
  broadcastHotkey(preferred);
  return null;
}

// ─── Tray ────────────────────────────────────────────────────────────────────

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();

  // macOS 菜单栏不会自动缩放托盘图标，256×256 的原图会把菜单栏撑破
  if (isMac && !icon.isEmpty()) {
    icon = icon.resize({ width: 16, height: 16 });
    // setTemplateImage 需要「纯黑 + alpha」的图形才能随浅色/深色菜单栏正确反色，
    // 当前 icon.png 是彩色图，开了会变成一团黑。备好 assets/iconTemplate.png
    // （16×16 与 @2x 的 32×32）之后再启用下面这行：
    // icon.setTemplateImage(true);
  }

  tray = new Tray(icon);
  tray.setToolTip('SmartCalendar');

  const menu = Menu.buildFromTemplate([
    { label: '打开 SmartCalendar', click: showWindow },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);

  if (isMac) {
    // macOS 上一旦调用 setContextMenu()，左键点击就只会弹出菜单，'click' 事件
    // 不再触发，托盘会失去「点一下打开窗口」的能力 —— 而它正是热键失效时的
    // 唯一入口。所以这里改成左键开窗、右键弹菜单。
    tray.on('click', showWindow);
    tray.on('right-click', () => tray.popUpContextMenu(menu));
  } else {
    tray.setContextMenu(menu);
    tray.on('click', showWindow);
  }
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // macOS: 菜单栏常驻工具不应占用 Dock（Windows 侧由 skipTaskbar 负责）。
  // 打包时还需配合 Info.plist 的 LSUIElement，否则启动瞬间 Dock 会闪一下。
  if (isMac) app.dock?.hide();

  store.init();
  createWindow();
  createTray();

  applyHotkey(store.get('hotkey', DEFAULT_HOTKEY));
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (authServer) { authServer.close(); authServer = null; }
});

app.on('window-all-closed', () => {
  // 托盘常驻应用：窗口关闭不退出。窗口实际只会 hide()，这里是兜底。
  // 注意 window-all-closed 回调不接收 event 参数，原来的 e.preventDefault() 会抛异常。
});

// ─── IPC: Window ─────────────────────────────────────────────────────────────

ipcMain.on('window:hide', () => mainWindow?.hide());

ipcMain.on('window:setPinned', (_, value) => { isPinned = !!value; });

// ─── IPC: Settings (narrow, no generic store access) ─────────────────────────

ipcMain.handle('settings:getStatus', () => {
  const secure = store.secureStatus();
  return {
    // 用 has() 而非 get()：钥匙串读不出来时，配置依然是「配置过」的，
    // 报成未配置会诱导用户去重填一个当下根本存不进去的值。
    hasGeminiKey: store.has('geminiApiKey'),
    hasGoogleAuth: store.has('googleRefreshToken'),
    hasClipboardConsent: !!store.get('clipboardConsent'),
    secureStorageOk: secure.ok,
    secureStorageError: secure.message,
  };
});

ipcMain.handle('settings:saveGeminiKey', (_, key) => {
  store.set('geminiApiKey', key);
});

ipcMain.handle('settings:saveGoogleCreds', (_, { clientId, clientSecret }) => {
  store.set('googleClientId', clientId);
  if (clientSecret) store.set('googleClientSecret', clientSecret);
  else store.delete('googleClientSecret');
});

ipcMain.handle('settings:setClipboardConsent', (_, value) => {
  store.set('clipboardConsent', !!value);
});

ipcMain.handle('settings:getHotkey', () => ({
  active: activeHotkey,
  saved: store.get('hotkey', DEFAULT_HOTKEY),
  fallback: DEFAULT_HOTKEY,
}));

ipcMain.handle('settings:setHotkey', (_, accelerator) => {
  // 空值表示「恢复默认」
  const value = String(accelerator || '').trim() || DEFAULT_HOTKEY;
  store.set('hotkey', value);
  applyHotkey(value);
  return { active: activeHotkey, saved: value, fallback: DEFAULT_HOTKEY };
});

ipcMain.handle('settings:clearAll', () => {
  store.clearAll();
  applyHotkey(DEFAULT_HOTKEY);
});

// ─── IPC: Gemini API (main process only) ─────────────────────────────────────

ipcMain.handle('api:analyze', async (_, { text, timezone }) => {
  const apiKey = store.get('geminiApiKey');
  if (!apiKey) {
    throw new Error(
      store.has('geminiApiKey')
        ? `无法读取已保存的 Gemini API Key。${SECURE_STORAGE_HINT}`
        : '请先在设置中配置 Gemini API Key。'
    );
  }

  const now = new Date();
  const systemPrompt = `Extract event details strictly as JSON:
- summary (string. The event title)
- location (string. Physical addresses only, e.g., "Room 303". Do NOT put URLs here. Leave empty if none.)
- start (ISO 8601 datetime, inferred from current time)
- end (ISO 8601 datetime, default 1 hour after start)
- description (string. Original text. Preserve any meeting URLs here.)
- reminder_minutes (integer. Use user-specified value or default 10)

Output pure JSON only, no explanation.`;

  const promptText =
    `${systemPrompt}\n\n` +
    `Current time: ${now.toISOString()} (timezone: ${timezone})\n` +
    `User Input: """${text}"""`;

  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent' +
    `?key=${encodeURIComponent(apiKey)}`;

  const res = await httpsRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] }));

  if (res.status !== 200) throw new Error(`Gemini API 调用失败（HTTP ${res.status}）`);

  const rawText = (res.data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim();

  if (!rawText) throw new Error('Gemini 返回内容为空');

  let jsonStr = rawText;
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  }

  return JSON.parse(jsonStr);
});

// ─── IPC: Google Calendar API (main process only) ────────────────────────────

async function getValidToken() {
  const token = store.get('googleAccessToken');
  const expiry = store.get('googleTokenExpiry', 0);

  if (token && Date.now() < expiry - 30_000) return token;

  const refreshToken = store.get('googleRefreshToken');
  const clientId = store.get('googleClientId');
  if (!refreshToken || !clientId) {
    const saved = store.has('googleRefreshToken') && store.has('googleClientId');
    throw new Error(
      saved
        ? `无法读取已保存的 Google 凭据。${SECURE_STORAGE_HINT}`
        : '未授权，请先在设置中点击"连接 Google 账户"。'
    );
  }

  const clientSecret = store.get('googleClientSecret', '');
  const refreshParams = {
    refresh_token: refreshToken,
    client_id: clientId,
    grant_type: 'refresh_token',
  };
  if (clientSecret) refreshParams.client_secret = clientSecret;

  const tokens = await httpsPost('https://oauth2.googleapis.com/token', refreshParams);
  if (tokens.error) throw new Error(tokens.error_description || tokens.error);

  store.set('googleAccessToken', tokens.access_token);
  store.set('googleTokenExpiry', Date.now() + (tokens.expires_in || 3600) * 1000);
  return tokens.access_token;
}

ipcMain.handle('api:createEvent', async (_, event) => {
  const token = await getValidToken();

  const res = await httpsRequest(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
    JSON.stringify(event),
  );

  if (res.status === 401) throw new Error('Google 授权失效，请在设置中重新连接账户。');
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`写入 Calendar 失败（HTTP ${res.status}）`);
  }

  return res.data;
});

// ─── IPC: Google OAuth2 (PKCE + CSRF state) ─────────────────────────────────

ipcMain.handle('auth:google', () => {
  return new Promise((resolve, reject) => {
    const clientId = store.get('googleClientId');
    if (!clientId) {
      reject(new Error('请先在设置中填写 Google Client ID'));
      return;
    }

    const { verifier, challenge } = generatePKCE();
    const oauthState = crypto.randomBytes(16).toString('hex');

    const authParams = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: CALENDAR_SCOPE,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
      state: oauthState,
    });

    if (authServer) { authServer.close(); authServer = null; }

    let settled = false;
    isAuthing = true;   // 授权期间浏览器会抢走焦点，暂停失焦自动隐藏
    const settle = (fn, val) => {
      if (settled) return;
      settled = true;
      isAuthing = false;
      if (authServer) { authServer.close(); authServer = null; }
      // 授权结果（无论成功失败）需要用户看见，把窗口重新带回前台
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
      fn(val);
    };

    authServer = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url, `http://localhost:${OAUTH_PORT}`);
      if (reqUrl.pathname !== '/oauth2callback') {
        res.writeHead(404); res.end(); return;
      }

      const returnedState = reqUrl.searchParams.get('state');
      if (returnedState !== oauthState) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('State mismatch — possible CSRF attack.');
        settle(reject, new Error('OAuth state 校验失败，请重试'));
        return;
      }

      const code = reqUrl.searchParams.get('code');
      const error = reqUrl.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<html><head><meta charset="utf-8"><style>body{font-family:system-ui;' +
        'display:flex;align-items:center;justify-content:center;height:100vh;margin:0;' +
        'background:#0f172a;color:#f9fafb}</style></head>' +
        '<body><div style="text-align:center"><h2 style="color:#22c55e">授权成功</h2>' +
        '<p style="color:#9ca3af">可以关闭此标签页，返回 SmartCalendar。</p></div></body></html>'
      );

      if (error) { settle(reject, new Error(`授权被拒绝: ${error}`)); return; }
      if (!code)  { settle(reject, new Error('未收到授权码')); return; }

      try {
        const clientSecret = store.get('googleClientSecret', '');
        const tokenParams = {
          code,
          client_id: clientId,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        };
        if (clientSecret) tokenParams.client_secret = clientSecret;

        const tokens = await httpsPost('https://oauth2.googleapis.com/token', tokenParams);

        if (tokens.error) {
          settle(reject, new Error(tokens.error_description || tokens.error)); return;
        }

        store.set('googleAccessToken', tokens.access_token);
        if (tokens.refresh_token) store.set('googleRefreshToken', tokens.refresh_token);
        store.set('googleTokenExpiry', Date.now() + (tokens.expires_in || 3600) * 1000);

        settle(resolve, { success: true });
      } catch (err) {
        settle(reject, err);
      }
    });

    // Bind to 127.0.0.1 only — prevent external access
    authServer.listen(OAUTH_PORT, '127.0.0.1', () => {
      shell.openExternal(
        `https://accounts.google.com/o/oauth2/v2/auth?${authParams}`
      );
    });

    setTimeout(
      () => settle(reject, new Error('授权超时（3 分钟内未完成）')),
      180_000
    );
  });
});

ipcMain.handle('auth:hasToken', () => !!store.get('googleRefreshToken'));

// ─── IPC: System notifications ───────────────────────────────────────────────

ipcMain.on('notify', (_, { title, body }) => {
  if (Notification.isSupported()) new Notification({ title, body }).show();
});
