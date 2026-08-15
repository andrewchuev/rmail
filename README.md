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
- Sanitized HTML message rendering in a sandboxed iframe.

## Architecture & Refactoring

The codebase is currently undergoing a refactoring process to adhere strictly to Rust and TypeScript best practices. The monolithic React components (such as `App.tsx`) are being split into functional modules (e.g., `AccountSetup`), and the Rust backend logic is gaining standardized English docstrings and being verified against `cargo clippy` to ensure optimal performance and code health.

## Security

Passwords are stored in Tauri Stronghold. The Stronghold key and Gmail refresh tokens are stored in the operating system credential store. Passwords, tokens, email addresses, and message contents are excluded from diagnostic logs.

OAuth uses a random loopback callback on `127.0.0.1`, validates `state`, and uses PKCE. Google Desktop client credentials are supplied at build time through the ignored `.env` file. Changing an account identity clears its cached server data to prevent messages from different mailboxes from being mixed.

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

When developing in WSL, install `node_modules` inside WSL. Do not reuse dependencies installed by Windows. The checked-in Cargo configuration sets `SODIUM_DISABLE_PIE=1` for Stronghold's `libsodium` build.

## Current limitations

- Outgoing attachments, HTML composition, and IMAP Sent-folder copies are not implemented.
- Drafts cannot yet be listed or reopened from the UI.
- Read, flag, archive, and delete IMAP actions are not implemented.
- Search covers cached sender and subject fields, not full message bodies.
