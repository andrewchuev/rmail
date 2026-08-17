# RMail

RMail is a lightweight desktop email client built with Rust, Tauri 2, React, and TypeScript.

## Features

- Multiple IMAP/SMTP accounts and a unified inbox.
- Gmail OAuth 2.0 with PKCE and XOAUTH2 for IMAP and SMTP.
- Editable account connection settings with verification before saving.
- Background synchronization with configurable frequency, system notifications, and tray behavior.
- Non-blocking cache refreshes that preserve the selected message and open content.
- Local SQLite cache for mailboxes, headers, opened message bodies, attachment metadata, and drafts.
- Plain-text composition, local drafts, SMTP sending, and explicit attachment downloads.
- Mark individual or all messages as read with background IMAP synchronization and instant local UI updates.
- Dynamic system tray icon indicating unread message status.
- Sanitized HTML message rendering in a sandboxed iframe.

## Architecture & Refactoring

The codebase is verified against `cargo clippy` and `oxlint`/`tsc` to keep it aligned with current Rust and TypeScript best practices. Mark-as-read now awaits the remote IMAP update instead of firing it in the background and discarding the result, so sync failures surface as real errors instead of silently diverging the local cache from the server. IMAP-command error messages are propagated as-is rather than collapsed to `"unknown"`. All Tauri commands invoked from the frontend go through typed wrappers in `src/lib/accounts.ts` (no ad-hoc untyped `invoke()` calls), and every cache-comparison helper in `src/lib/utils.ts` is fully typed. Unused/duplicated code (a stray debug binary, an abandoned account-setup draft, and orphaned message-list/viewer components) has been removed rather than left to rot.

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
