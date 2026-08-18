# RMail

RMail is a lightweight desktop email client built with Rust, Tauri 2, React, and TypeScript.

## Features

- Multiple IMAP/SMTP accounts and a unified inbox.
- Gmail OAuth 2.0 with PKCE and XOAUTH2 for IMAP and SMTP.
- Editable account connection settings with verification before saving.
- Background synchronization with configurable frequency and tray behavior.
- Per-account desktop notifications for new mail, off by default; a general switch gates all of them. A global sender exclusion list (Settings) additionally silences the notification and the tray unread indicator for specific senders, regardless of which account they arrive in.
- Non-blocking cache refreshes that preserve the selected message and open content.
- Local SQLite cache for mailboxes, headers, opened message bodies, attachment metadata, and drafts.
- Plain-text composition, local drafts, SMTP sending, and explicit attachment downloads.
- Mark individual, selected, or all messages as read; delete individual or multi-selected messages (moved to the account's Trash mailbox).
- A classic expandable folder tree per account, and renameable account names (Gmail accounts default to "email (name)" to stay distinguishable).
- Dynamic system tray icon indicating unread message status.
- Sanitized HTML message rendering in a sandboxed iframe.
- Clear message cache from Settings: wipes cached mailboxes/messages/bodies/attachments and reclaims disk space (`VACUUM`), without touching accounts, stored credentials, or local drafts. Logs the mailbox/message counts cleared, since the UI immediately resynchronizes afterward and would otherwise look like a no-op.
- Right-click a message for Reply (pre-fills the sender's address and a "Re:" subject, without doubling an existing prefix), Exclude from notifications, and Delete.

## Architecture & Refactoring

The codebase is verified against `cargo clippy` and `oxlint`/`tsc` to keep it aligned with current Rust and TypeScript best practices. Mark-as-read now awaits the remote IMAP update instead of firing it in the background and discarding the result, so sync failures surface as real errors instead of silently diverging the local cache from the server. IMAP-command error messages are propagated as-is rather than collapsed to `"unknown"`. All Tauri commands invoked from the frontend go through typed wrappers in `src/lib/accounts.ts` (no ad-hoc untyped `invoke()` calls), and every cache-comparison helper in `src/lib/utils.ts` is fully typed. Unused/duplicated code (a stray debug binary, an abandoned account-setup draft, and orphaned message-list/viewer components) has been removed rather than left to rot. SMTP transport construction (STARTTLS relay, password vs. OAuth XOAUTH2 credentials) is factored into one `build_smtp_transport` helper shared by connection testing and sending, instead of being duplicated in both.

Two behavioral bugs were found and fixed during the latest audit:

- The HTML message iframe's `sandbox` attribute (`allow-same-origin` only) silently blocked every `target="_blank"` link in an HTML email - clicking a link did nothing, with no visible error. Confirmed with an isolated sandboxed-iframe reproduction (`Blocked opening '...' in a new window because the request was made in a sandboxed frame whose 'allow-popups' permission is not set.`) before and after the fix. `allow-popups allow-popups-to-escape-sandbox` was added so links open in a real, unsandboxed browser tab; `allow-scripts` remains withheld, so injected `<script>` tags in a message still cannot execute.
- The Ctrl+wheel and Ctrl+=/-/0 zoom shortcuts called the app's own `webview.setZoom` but never called `event.preventDefault()`, so they could double up with the WebView2 host's native Ctrl+scroll/Ctrl+key zoom handling. Both handlers now call `preventDefault()`.
- Remote-hosted images in HTML messages rendered as broken image icons even though `sanitize_html` explicitly allows `<img>` through: the app's CSP `img-src` only permitted `'self' asset: http://asset.localhost data:`, so the webview blocked every `https://...`/`http://...` image request regardless of what the sanitizer let past. Confirmed by inspecting a cached message's sanitized HTML directly (`src` attributes were intact, absolute, and independently reachable via `curl`) before ruling out the sanitizer and finding the CSP gap. `img-src` now also allows `https:` and `http:` in both `security.csp` and `security.devCsp` in `tauri.conf.json`.
- The `Button` component's `destructive` variant used `text-destructive` on a `bg-destructive/10`/`dark:bg-destructive/20` tint - both derived from the same muted `--destructive` token, which is quite dark in the `.dark` theme. Measured contrast (WCAG relative-luminance formula, via a canvas-rendered pixel readback of the resolved colors) was **1.85:1**, far under the 3:1 minimum for UI components, which is exactly why the "Confirm" button on the new cache-flush action was nearly invisible in dark mode. `destructive` is now a solid `bg-destructive`/`text-destructive-foreground` button (a `--destructive-foreground` token was added, mirroring the existing `--primary`/`--primary-foreground` pattern), measuring **9.60:1** in dark mode.
- The HTML message iframe grew its own tiny, barely-draggable inner scrollbar (a "few pixels" of range) on every message, regardless of content. Root cause: the iframe has a 1px `border` and the app's global Tailwind reset makes it `box-sizing: border-box`, so the border was subtracted from the content-rendering area - while the resize effect sets `frame.style.height` to match the inner document's `scrollHeight` exactly, leaving the document ~2px (2x border-width) too tall for the space actually available to it. Confirmed by instrumenting the real resize lifecycle against a cached message's HTML end-to-end (`iframe.clientHeight` vs. the inner document's `scrollHeight`: a deterministic, non-timing-dependent 2px shortfall on every load) before and after the fix. The iframe is now pinned to `box-sizing: content-box` so its height always means content height, with the border added on top rather than eating into it.
- `text-destructive` (plain red text/icons on a neutral surface: form error messages, a destructive context-menu item) turned out to have the same problem as the earlier button fix, and in the same place: `--destructive` in the `.dark` theme is tuned dark enough for good white-text-on-red contrast in a solid button, but that makes it too dark to read as text on the near-black `--popover`/`--card`/`--background`. Measured **1.97:1** for the new "Delete" context-menu item before the fix - reusing `--destructive` can't satisfy both uses at once (raising its lightness enough to fix text-on-dark-surface contrast pushes white-on-red-button contrast below 4.5:1 past L≈0.575). A new `--destructive-text` token (dark theme: `oklch(0.65 0.141 25.723)`, measuring **5.76:1**; light theme unchanged, already passing at 4.58-4.78:1) now backs every plain destructive-text usage, leaving `--destructive`/`--destructive-foreground` solely for solid destructive buttons.
- `cachedMessagesEqual` (the cache-diffing helper that decides whether to skip a state update after a cache refetch) didn't compare `senderEmail`, so a message whose address gets backfilled by a later sync while every other field stays the same could keep showing a stale, empty `senderEmail` - silently breaking notification-exclusion matching for that message until something else about it changed. `senderEmail` is now part of the comparison.

The per-sender notification exclusion list matches against the sender's raw email address, not their display name (a name a sender fully controls and that varies per message - "Digest", "Newsletter", etc.). Previously only the display name was persisted (`snapshot_message`/`format_address` discarded the address once a display name was present); `format_address` now returns both, and `messages.sender_email` (backfilled for existing rows via `ADD COLUMN ... DEFAULT ''`, populated on the next sync) is the identifier the exclusion list, the tray unread count, and the background-sync notification count all filter on.

## Security

Passwords and Gmail refresh tokens are stored in the operating system credential store using native keychains. Passwords, tokens, email addresses, and message contents are excluded from diagnostic logs.

The frontend never handles account passwords. Every Tauri command that talks to IMAP/SMTP takes only an `accountId`; the Rust backend resolves the stored password (or a fresh OAuth token) from the OS keyring itself, so a plaintext secret never crosses the webview↔Rust IPC boundary.

OAuth uses a random loopback callback on `127.0.0.1`, validates `state`, and uses PKCE. Google Desktop client credentials are supplied at build time through the ignored `.env` file. Changing an account identity clears its cached server data to prevent messages from different mailboxes from being mixed.

## Performance

IMAP connections are pooled per account (`src-tauri/src/imap_pool.rs`): opening a message, marking it read, and syncing reuse one cached, logged-in session instead of paying a fresh TCP+TLS+LOGIN round trip for every action. A session is transparently dropped and reconnected once if a cached connection turns out to be dead (e.g. the server closed it after being idle), and it's evicted outright when an account's credentials or connection settings change.

## Development

Requirements:

- Current Node.js and npm
- Current stable Rust toolchain
- Google OAuth Desktop client credentials for Gmail support

Create the local configuration and start the application:

```bash
cp .env.example .env
npm install
npm run tauri dev
```

Set `RMAIL_GOOGLE_CLIENT_ID` and `RMAIL_GOOGLE_CLIENT_SECRET` in `.env`. The file is excluded from Git.

Run the project checks:

```bash
npm run lint
npm run build
npm audit --omit=dev
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

When developing in WSL, install `node_modules` inside WSL. Do not reuse dependencies installed by Windows.

### Versioning

The version lives in five places that must agree: `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`. Major and minor are set by hand by editing all five; the patch number is bumped automatically, one file at a time, by `scripts/bump-version.mjs`.

To cut a release build, use:

```bash
npm run release
```

This runs `npm run version:bump` (patch += 1 across all five files) and then `tauri build`, so every produced build carries a version newer than the last. Run `npm run version:bump` on its own to just bump the patch without building. The script refuses to run if the files are already out of sync, so a failed bump means a version was edited by hand somewhere and needs reconciling first.

## Current limitations

- Outgoing attachments, HTML composition, and IMAP Sent-folder copies are not implemented.
- Drafts cannot yet be listed or reopened from the UI.
- Flag, archive, and delete IMAP actions are not implemented (Mark as read is now fully supported).
- Search covers cached sender and subject fields, not full message bodies.

## Non-goals

Intentionally out of scope for now:

- OAuth for providers other than Gmail.
- Calendar, contacts, server-side rules, and filters.
- PGP/S-MIME, snooze, scheduled send, and AI features.
- Mobile clients and team/shared-inbox collaboration.
