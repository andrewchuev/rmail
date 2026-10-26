# RMail

RMail is a lightweight desktop email client built with Rust, Tauri 2, React, and TypeScript.

## Features

- Multiple IMAP/SMTP accounts with a unified inbox.
- Gmail OAuth 2.0 (PKCE + XOAUTH2) alongside standard IMAP/SMTP password accounts.
- Background sync with configurable frequency, tray unread icon, and desktop notifications (per-account toggle, plus a global per-sender exclusion list).
- Local SQLite cache for mailboxes, messages, bodies, attachments, and drafts; clearable from Settings.
- Reply, Reply all, and Forward with quoted original text and RFC 5322 threading headers (`In-Reply-To`/`References`); Reply prefers the message's `Reply-To` header over `From` when present.
- Plain-text composition (To/Cc), local drafts, SMTP sending, and attachment downloads.
- Mark as read (single, selected, or all); delete (moves to the account's Trash mailbox).
- Expandable folder tree per account, with renameable account names.
- Sanitized HTML message rendering in a sandboxed iframe.

## Security

- Passwords and Gmail refresh tokens live in the OS credential store (native keychain) and are never written to logs.
- The frontend never handles account passwords - Rust resolves credentials from the keyring by `accountId`.
- OAuth uses a random loopback callback, validates `state`, and uses PKCE.
- Changing an account's identity clears its cached data.

## Performance

IMAP connections are pooled per account (`src-tauri/src/imap_pool.rs`) and reused across actions, with automatic reconnect if a cached connection has gone dead.

## Development

Requirements: current Node.js/npm, current stable Rust, and Google OAuth Desktop client credentials (for Gmail support).

```bash
cp .env.example .env
npm install
npm run tauri dev
```

Set `RMAIL_GOOGLE_CLIENT_ID` and `RMAIL_GOOGLE_CLIENT_SECRET` in `.env` (gitignored).

Checks:

```bash
npm run lint
npm run build
npm audit --omit=dev
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

When developing in WSL, install `node_modules` inside WSL rather than reusing a Windows install.

### Versioning

The version lives in five files that must agree: `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`. Bump major/minor by hand across all five; the patch number is bumped automatically by `scripts/bump-version.mjs`.

```bash
npm run release
```

Bumps the patch version across all five files, then runs `tauri build`.

## Current limitations

- Outgoing attachments, HTML composition, and IMAP Sent-folder copies are not implemented.
- Drafts cannot be listed or reopened from the UI.
- Flag and archive are not implemented.
- Search covers cached sender and subject fields, not full message bodies.

## Non-goals

- OAuth for providers other than Gmail.
- Calendar, contacts, server-side rules, and filters.
- PGP/S-MIME, snooze, scheduled send, and AI features.
- Mobile clients and team/shared-inbox collaboration.
