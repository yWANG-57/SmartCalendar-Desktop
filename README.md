# SmartCalendar Desktop

A lightweight desktop app that turns any copied text into a Google Calendar event using AI.

**Copy text -> press the hotkey -> Analyze -> Save to Calendar**

Default hotkey: `Cmd+Option+S` on macOS, `Ctrl+Alt+S` on Windows. Both are configurable in Settings.

## Features

- Configurable global hotkey to instantly capture clipboard text
- Runs in the menu bar (macOS) or system tray (Windows)
- AI-powered event extraction via Google Gemini API
- One-click save to Google Calendar
- Editable event preview before saving
- Encrypted local storage for all credentials
- Privacy-first: no data stored on any server, all processing via your own API keys

## Installation

### Windows

Download `SmartCalendar Setup <version>.exe` from [Releases](../../releases) and install.

> Windows SmartScreen may warn "Unknown publisher" — click **More info -> Run anyway**.

### macOS

Download the `.dmg` for your architecture (`arm64` for Apple Silicon, `x64` for Intel) from
[Releases](../../releases) and drag SmartCalendar to Applications.

The app is **not code-signed or notarized** (that requires a paid Apple Developer account), so
Gatekeeper will refuse to open it. Clear the quarantine attribute once after installing:

```bash
xattr -dr com.apple.quarantine /Applications/SmartCalendar.app
```

SmartCalendar lives in the menu bar only — it deliberately has no Dock icon and no
`Cmd+Tab` entry.

## Setup (first-time only)

### 1. Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Click **Create API Key**
3. Paste it into SmartCalendar Settings -> **Gemini API Key** -> Save

### 2. Google OAuth2 (for Calendar access)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (e.g., `SmartCalendar`)
3. **APIs & Services -> Library** -> Search and enable **Google Calendar API**
4. **Google Auth Platform -> Audience** -> Add your Gmail as a **Test user**
5. **APIs & Services -> Credentials -> + Create Credentials -> OAuth client ID**
   - Application type: **Desktop app**
   - Copy the **Client ID** and **Client Secret**
6. Paste them into SmartCalendar Settings -> Save -> Click **Connect Account**
7. Authorize in the browser popup

## Usage

1. Copy any text containing event info (e.g., "Meeting tomorrow at 3pm in Room 201")
2. Press the global hotkey — or click the menu bar / tray icon, which always works even if
   the hotkey failed to register
3. Click **Analyze** — AI extracts title, time, location, etc.
4. Edit if needed, then click **Save to Calendar**

## Changing the hotkey

Open **Settings -> Global hotkey**, click the field and press the combination you want. The app
registers it immediately and tells you if it was already taken by another program.

A global hotkey is **preemptive** — once registered, that combination is intercepted in every
application. A few combinations to avoid:

| Avoid | Why |
| --- | --- |
| `Ctrl+Space`, `Ctrl+Option+Space` (macOS) | Input-source switching; taking it breaks IME switching |
| `Cmd+Space` (macOS) | Spotlight |
| `Cmd`+single letter (macOS) | Disables that shortcut in every app system-wide |
| `Ctrl+Alt`+letter (Windows) | Equals `AltGr`+letter on many European layouts, breaking `@ € ł ś` input |

The Fn / Globe key cannot be used as a modifier — Electron's `globalShortcut` does not support it.

**Conflict detection is limited.** On Windows, registering an already-taken combination fails and
SmartCalendar falls back to another one automatically. On macOS the OS does not let applications
fight over global shortcuts: registration reports success even when another app already owns the
combination, and the shortcut simply never fires. If your hotkey seems dead, assume a conflict,
pick a different combination in Settings, and use the menu bar icon in the meantime.

On Linux under Wayland, global shortcut registration generally does not work at all; use the tray
icon, or bind a shortcut in your desktop environment instead.

## Daily Usage

**macOS** — launch SmartCalendar from Applications. It appears in the menu bar.

To start it at login: **System Settings -> General -> Login Items -> +** and add SmartCalendar.

**Windows** — launch SmartCalendar from the Start Menu or desktop shortcut. The app runs in the system tray.

**Auto-start on boot (optional):**

1. Press `Win + R`, type `shell:startup`, press Enter
2. Right-click in the opened folder -> **New -> Shortcut**
3. Browse to `C:\Users\<YourName>\AppData\Local\Programs\SmartCalendar\SmartCalendar.exe`
4. Name it `SmartCalendar` -> Finish

The app will now start automatically when you log in.

## Privacy & Security

- All API keys and tokens are **encrypted locally** using OS-level encryption (Electron safeStorage).
  If the OS credential store is unavailable, saving **fails with an error** rather than silently
  falling back to writing the secret in plaintext
- Your text is sent to **Google Gemini API** for event parsing — no other third-party services
- No user data is stored or transmitted by this application
- All network requests run in the main process; the UI layer has no network access (CSP enforced)

## Build from source

Requires Node.js 18+.

```bash
npm install
npm start          # run in development
npm run build      # package for the current platform
```

`npm run build:mac` and `npm run build:win` target a specific platform. Building the Windows
installer from macOS requires wine — build each platform on its own OS.

The macOS build produces one `.dmg` per architecture (`arm64` and `x64`). Since there is no Apple
Developer certificate, `build.mac.identity` is `null` and `scripts/afterPack.js` ad-hoc signs the
bundle instead — without it the inherited Electron signature is left invalid and `codesign --verify`
fails. Ad-hoc signatures are not notarized, so Gatekeeper still rejects the app until the user
clears the quarantine attribute (see Installation).

> **macOS gotcha:** credentials are encrypted with Electron `safeStorage`, which keeps its key in
> the login Keychain under `<app name> Safe Storage`. That name comes from the `name` field in
> `package.json`, so the development and packaged builds share one entry and stored credentials
> *do* carry over between them.
>
> Keychain *access*, however, is granted per code signature. The first launch of a packaged build
> therefore prompts for the login password, and since ad-hoc signatures change on every build, each
> rebuild prompts again — choose "Always Allow". Denying it makes `safeStorage` fail, and because
> `Store.get()` swallows decryption errors the app will simply claim the API key is not configured.

## License

MIT
