import { type CachedMessage } from "@/lib/accounts";

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
  return decodeMutf7(path);
}

export function messageKey(message: Pick<CachedMessage, "accountId" | "mailboxPath" | "uid">) {
  return `${message.accountId}:${message.mailboxPath}:${message.uid}`;
}
