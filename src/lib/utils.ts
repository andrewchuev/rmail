import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { CachedMailbox, CachedMessage, MessageBody } from "@/lib/accounts"

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
      && message.senderEmail === candidate.senderEmail
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

/**
 * Builds the quoted-original-message block used to pre-fill a reply body,
 * in the conventional "On <date>, <sender> wrote:" + "> "-prefixed form.
 */
export function quoteMessageBody(message: CachedMessage, body: MessageBody): string {
  const quotedLines = body.text.split("\n").map((line) => `> ${line}`).join("\n");
  return `On ${message.date}, ${message.sender} <${message.senderEmail}> wrote:\n${quotedLines}`;
}

/**
 * Builds the "forwarded message" header block + original body used to
 * pre-fill a forward body.
 */
export function buildForwardBody(message: CachedMessage, body: MessageBody): string {
  return `---------- Forwarded message ---------\nFrom: ${message.sender} <${message.senderEmail}>\nDate: ${message.date}\nSubject: ${message.subject}\nTo: ${body.to}\n\n${body.text}`;
}

/**
 * Merges comma/semicolon-separated address lists into one deduplicated,
 * case-insensitively compared list, dropping any address in `exclude`.
 * Used to build the Cc line for "Reply All".
 */
// Splits on , or ; only outside quoted display names and <...> so "Doe, John" <j@x> stays intact.
function splitAddressList(list: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let inAngle = false;
  for (const char of list) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && char === "<") inAngle = true;
    else if (!inQuotes && char === ">") inAngle = false;
    if (!inQuotes && !inAngle && (char === "," || char === ";")) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

// Compare by bare address so "Name <a@b>" matches "a@b".
function bareAddressKey(address: string): string {
  return (/<([^<>]+)>/.exec(address)?.[1] ?? address).trim().toLowerCase();
}

export function mergeRecipientLists(lists: (string | null | undefined)[], exclude: string[] = []): string {
  const excludeSet = new Set(
    exclude.filter(Boolean).flatMap(splitAddressList).map(bareAddressKey).filter(Boolean),
  );
  const seen = new Set<string>();
  const result: string[] = [];
  for (const list of lists) {
    if (!list) continue;
    for (const raw of splitAddressList(list)) {
      const address = raw.trim();
      if (!address) continue;
      const key = bareAddressKey(address);
      if (excludeSet.has(key) || seen.has(key)) continue;
      seen.add(key);
      result.push(address);
    }
  }
  return result.join(", ");
}

/** Builds the `References` header value for a reply, per RFC 5322 §3.6.4. */
export function mergeReferences(originalReferences: string | null, originalMessageId: string | null): string | null {
  if (!originalMessageId) return originalReferences;
  return originalReferences ? `${originalReferences} ${originalMessageId}` : originalMessageId;
}

export function cachedMailboxesEqual(left: CachedMailbox[], right: CachedMailbox[]) {
  return left.length === right.length && left.every((mailbox, index) => {
    const candidate = right[index];
    if (!candidate) return false;
    return mailbox.path === candidate.path
      && mailbox.unreadCount === candidate.unreadCount;
  });
}
