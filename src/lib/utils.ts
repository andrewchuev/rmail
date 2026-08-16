import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

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
  const decoded = decodeMutf7(path);
  return decoded;
}

export function attachmentFileName(name: string) {
  return name.replace(/[\\\\/]/g, "_").trim() || "attachment";
}

export function messageKey(message: { accountId: number; mailboxPath: string; uid: number; }) {
  return `${message.accountId}:${message.mailboxPath}:${message.uid}`;
}

export function cachedMessagesEqual(left: any[], right: any[]) {
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

export function cachedMailboxesEqual(left: any[], right: any[]) {
  return left.length === right.length && left.every((mailbox, index) => {
    const candidate = right[index];
    if (!candidate) return false;
    return mailbox.path === candidate.path
      && mailbox.unreadCount === candidate.unreadCount;
  });
}
