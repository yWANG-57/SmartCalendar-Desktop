# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-09-11

### Added

- **Launch at login**, toggled in Settings. Registers the app as a hidden login item so
  it comes back in the menu bar after a restart. Refused in development mode, where it
  would register the Electron binary itself rather than the app.

### Changed

- **Opening the window now appends the clipboard instead of replacing the text box.**
  The details of one event are often spread across several places and have to be copied
  a few times; each reopen used to discard whatever had been collected so far. New
  clipboard content is appended on its own line, identical content is not appended
  twice, and an empty clipboard leaves the box untouched. Appending after a parse marks
  the preview stale and disables Save until Analyze is run again.
- The window no longer auto-hides while the text box has content, so switching away to
  copy the next fragment does not make the draft disappear. Closing it explicitly still
  works.

## [1.1.1] - 2026-09-11

### Fixed

- After saving an event, reopening the window re-filled the text box with the same
  text that had just been saved. `showWindow()` reads the clipboard on every
  invocation, and saving to Calendar does not change the clipboard, so the already
  captured text kept coming back. The clipboard content consumed by a successful save
  is now remembered (in memory only — clipboard content is never written to disk) and
  skipped on the next open, leaving an empty box. Copying anything new fills the box
  as before.
- The event preview fields are cleared after a save completes instead of lingering
  until the next time the window is opened.

## [1.1.0] - 2026-09-11

macOS support. This release ships macOS installers only — the changes below apply to
Windows as well, but no Windows installer was produced for 1.1.0.

### Added

- **macOS support.** Runs as a menu-bar app with no Dock icon and no `Cmd+Tab` entry.
  Left-click the menu bar icon to open the window, right-click for the menu.
- Window appears above fullscreen apps and hides when it loses focus. Hiding is
  suppressed while an unsaved parsed event is on screen, while the settings panel is
  open, and during Google sign-in.
- **Configurable global hotkey**, editable in Settings by pressing the combination.
  Defaults to `Cmd+Option+S` on macOS and `Ctrl+Alt+S` on Windows. The recorder
  rejects modifier-less combinations and warns about combinations known to conflict
  (input-source switching and Spotlight on macOS, `Ctrl+Alt`+letter on European
  layouts where it is equivalent to `AltGr`+letter).
- macOS build target producing ad-hoc signed `arm64` and `x64` dmgs.
- `CHANGELOG.md` and `.gitattributes`.

### Changed

- The active hotkey is displayed in the title bar and settings panel instead of a
  hard-coded `Ctrl+Alt+S`.
- Hotkey registration failures are reported in the UI rather than only logged to the
  console. The tray icon remains a working entry point when no hotkey is available.
- `build:all` split into `build:mac` and `build:win`; cross-building the Windows
  installer from macOS requires wine.
- IPC error messages are unwrapped before display — Electron prefixes them with
  `Error invoking remote method '...'`, which buried the actual text.

### Fixed

- **Credentials could be written to disk in plaintext.** When the OS credential store
  was unavailable, `safeStorage` encryption was skipped and the API key and OAuth
  refresh token were saved unencrypted, while the app still described them as
  encrypted. Saving now fails with a visible error instead.
- **An unreadable credential was reported as a missing one.** Decryption failures were
  swallowed, so a denied Keychain prompt surfaced as "API key not configured" and sent
  users off to re-enter a key that could not be saved either. Stored-but-unreadable is
  now detected at startup and reported as a credential-store problem.
- Clicking the macOS menu bar icon did not open the window. Calling `setContextMenu()`
  makes a left click open the menu and suppresses the `click` event entirely.
- The 256x256 tray icon was not scaled down on macOS and overflowed the menu bar.
- Window placement was wrong on multi-monitor setups: the tray Y coordinate was
  compared against a height rather than the work area origin.
- `window-all-closed` receives no event argument, so the existing `e.preventDefault()`
  would have thrown had it ever fired.

### Known limitations

- The app is not notarized. Gatekeeper rejects it until the quarantine attribute is
  cleared, and because ad-hoc signatures change with every build, macOS asks to
  re-authorize Keychain access after each update.
- macOS does not let applications fight over global shortcuts: registration reports
  success even when another app owns the combination, and the shortcut then silently
  never fires. Automatic fallback to another combination only works on Windows.
- Global shortcuts generally do not work on Linux under Wayland.

## [1.0.0] - 2026-06-12

Initial release. Windows only.

### Added

- Global hotkey (`Ctrl+Alt+S`) to capture clipboard text.
- Event extraction via the Google Gemini API.
- Editable event preview, saved to Google Calendar in one click.
- Google OAuth2 sign-in using PKCE with CSRF state validation.
- Credentials encrypted locally with Electron `safeStorage`.
- Renderer isolated from the network by CSP; all API calls run in the main process.
- Windows NSIS installer.

[1.2.0]: https://github.com/yWANG-57/SmartCalendar-Desktop/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/yWANG-57/SmartCalendar-Desktop/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/yWANG-57/SmartCalendar-Desktop/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/yWANG-57/SmartCalendar-Desktop/releases/tag/v1.0.0
