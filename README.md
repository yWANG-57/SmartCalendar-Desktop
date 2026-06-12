# SmartCalendar Desktop

A lightweight desktop app that turns any copied text into a Google Calendar event using AI.

**Copy text -> Ctrl+Alt+S -> Analyze -> Save to Calendar**

## Features

- Global hotkey (Ctrl+Alt+S) to instantly capture clipboard text
- AI-powered event extraction via Google Gemini API
- One-click save to Google Calendar
- Editable event preview before saving
- Encrypted local storage for all credentials
- Privacy-first: no data stored on any server, all processing via your own API keys

## Installation

Download `SmartCalendar Setup 1.0.0.exe` from [Releases](../../releases) and install.

> Windows SmartScreen may warn "Unknown publisher" — click **More info -> Run anyway**.

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
2. Press **Ctrl+Alt+S** (or click the tray icon)
3. Click **Analyze** — AI extracts title, time, location, etc.
4. Edit if needed, then click **Save to Calendar**

## Privacy & Security

- All API keys and tokens are **encrypted locally** using OS-level encryption (Electron safeStorage)
- Your text is sent to **Google Gemini API** for event parsing — no other third-party services
- No user data is stored or transmitted by this application
- All network requests run in the main process; the UI layer has no network access (CSP enforced)

## Tech Stack

- Electron 28
- Google Gemini API (text analysis)
- Google Calendar API (event creation)
- OAuth2 with PKCE + CSRF protection

## License

MIT
