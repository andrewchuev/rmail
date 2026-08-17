import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { CachedMailbox, CachedMessage } from "@/lib/accounts"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function decodeMutf7(str: string): string {
  return str.replace(/&([^-]*)-/g, (_match, encoded: string) => {
    if (encoded === "") return "&";
    try {
      const b64 = encoded.replace(/,/g, "/");
      const bytes = atob(b64);
      let decoded = "";
      for (let i = 0; i < bytes.length; i += 2) {
        decoded += String.fromCharCode((bytes.charCodeAt(i) << 8) | bytes.charCodeAt(i + 1));
      }
      return decoded;
    } catch {
      return _match; // Fallback to original string if decoding fails
    }
  });
}

export function folderLabel(path: string) {
  if (path.toUpperCase() === "INBOX") return "Inbox";
  const withoutGmailPrefix = path.replace(/^\[Gmail\]\//i, "");
  return decodeMutf7(withoutGmailPrefix);
}

export function attachmentFileName(name: string) {
  return name.replace(/[\\\\/]/g, "_").trim() || "attachment";
}

export function messageKey(message: { accountId: number; mailboxPath: string; uid: number; }) {
  return `${message.accountId}:${message.mailboxPath}:${message.uid}`;
}

export function cachedMessagesEqual(left: CachedMessage[], right: CachedMessage[]) {
  return left.length === right.length && left.every((message, index) => {
    const candidate = right[index];
    if (!candidate) return false;
    return messageKey(message) === messageKey(candidate)
      && message.accountDisplayName === candidate.accountDisplayName
      && message.sender === candidate.sender
      && message.subject === candidate.subject
      && message.date === candidate.date
      && message.internalDate === candidate.internalDate
      && message.isRead === candidate.isRead;
  });
}

/**
 * Wraps a sanitized HTML message body in a standalone document with baseline
 * typography. Email HTML rarely declares its own font/colors, so without
 * this it inherits the browser's serif/black-on-transparent defaults and
 * reads poorly inside a dark-themed host page - a fixed light background
 * (like Gmail/Outlook's preview panes) keeps it legible regardless of the
 * app's theme.
 */
export function wrapEmailHtml(bodyHtml: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<base target="_blank" />
<style>
  :root { color-scheme: light; }
  html, body {
    margin: 0;
    padding: 20px 24px;
    background: #ffffff;
    color: #1f2328;
    font-family: "Geist Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.6;
  }
  body { overflow-wrap: anywhere; }
  img, video { max-width: 100%; height: auto; }
  table { max-width: 100%; border-collapse: collapse; }
  a { color: #2563eb; }
  pre, code { white-space: pre-wrap; overflow-wrap: anywhere; }
  blockquote { margin-left: 0; padding-left: 12px; border-left: 3px solid #e5e7eb; color: #4b5563; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

export function cachedMailboxesEqual(left: CachedMailbox[], right: CachedMailbox[]) {
  return left.length === right.length && left.every((mailbox, index) => {
    const candidate = right[index];
    if (!candidate) return false;
    return mailbox.path === candidate.path
      && mailbox.unreadCount === candidate.unreadCount;
  });
}
