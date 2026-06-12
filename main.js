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

// ─── Encrypted persistent store ──────────────────────────────────────────────

const SECURE_KEYS = new Set([
  'geminiApiKey',
  'googleClientId',
  'googleClientSecret',
  'googleAccessToken',
  'googleRefreshToken',
]);

class Store {
  constructor() {
    this._path = null;
    this._data = {};
  }

  init() {
    this._path = path.join(app.getPath('userData'), 'config.json');
    try {
      if (fs.existsSync(this._path)) {
        this._data = JSON.parse(fs.readFileSync(this._path, 'utf8'));
      }
    } catch {}
    this._migrateSecureKeys();
  }

  _migrateSecureKeys() {
    if (!safeStorage.isEncryptionAvailable()) return;
    let changed = false;
    for (const key of SECURE_KEYS) {
      const raw = this._data[key];
      if (typeof raw === 'string' && raw && !raw.startsWith('enc:')) {
        const encrypted = safeStorage.encryptString(raw);
        this._data[key] = 'enc:' + encrypted.toString('base64');
        changed = true;
      }
    }
    if (changed) this._save();
  }

  _save() {
    try {
      fs.writeFileSync(this._path, JSON.stringify(this._data, null, 2), 'utf8');
    } catch (e) {
      console.error('Store write error:', e);
    }
  }

  get(key, defaultVal = undefined) {
    const raw = key in this._data ? this._data[key] : undefined;
    if (raw === undefined) return defaultVal;
    if (SECURE_KEYS.has(key) && typeof raw === 'string' && raw.startsWith('enc:')) {
      try {
        const buf = Buffer.from(raw.slice(4), 'base64');
        return safeStorage.decryptString(buf);
      } catch {
        return defaultVal;
      }
    }
    return raw;
  }

  set(key, value) {
    if (SECURE_KEYS.has(key) && safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(String(value));
      this._data[key] = 'enc:' + encrypted.toString('base64');
    } else {
      this._data[key] = value;
    }
    this._save();
  }

  delete(key) {
    delete this._data[key];
    this._save();
  }

  clearAll() {
    this._data = {};
    this._save();
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

}

function positionWindow() {
  if (!tray || !mainWindow) return;
  const trayBounds = tray.getBounds();
  const winBounds = mainWindow.getBounds();
  const display = screen.getDisplayMatching(trayBounds);
  const wa = display.workArea;

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2);
  let y = trayBounds.y > wa.height / 2
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

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  store.init();
  createWindow();

  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开 SmartCalendar', click: showWindow },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ])
  );
  tray.on('click', showWindow);

  const shortcuts = ['Ctrl+Alt+S', 'Ctrl+Shift+Space', 'Alt+Shift+S'];
  const registered = shortcuts.find((s) => globalShortcut.register(s, showWindow));
  if (!registered) {
    console.warn('[SmartCalendar] Failed to register any global shortcut');
    tray.setToolTip('SmartCalendar');
  } else {
    console.log(`[SmartCalendar] Global shortcut registered: ${registered}`);
    tray.setToolTip(`SmartCalendar — ${registered}`);
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (authServer) { authServer.close(); authServer = null; }
});

app.on('window-all-closed', (e) => e.preventDefault());

// ─── IPC: Window ─────────────────────────────────────────────────────────────

ipcMain.on('window:hide', () => mainWindow?.hide());

// ─── IPC: Settings (narrow, no generic store access) ─────────────────────────

ipcMain.handle('settings:getStatus', () => ({
  hasGeminiKey: !!store.get('geminiApiKey'),
  hasGoogleAuth: !!store.get('googleRefreshToken'),
  hasClipboardConsent: !!store.get('clipboardConsent'),
}));

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

ipcMain.handle('settings:clearAll', () => {
  store.clearAll();
});

// ─── IPC: Gemini API (main process only) ─────────────────────────────────────

ipcMain.handle('api:analyze', async (_, { text, timezone }) => {
  const apiKey = store.get('geminiApiKey');
  if (!apiKey) throw new Error('请先在设置中配置 Gemini API Key。');

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
    throw new Error('未授权，请先在设置中点击"连接 Google 账户"。');
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
    const settle = (fn, val) => {
      if (settled) return;
      settled = true;
      if (authServer) { authServer.close(); authServer = null; }
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
