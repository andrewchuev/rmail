import { invoke, isTauri } from "@tauri-apps/api/core";

export type Account = {
  id: number;
  email: string;
  displayName: string;
  imapHost: string;
  smtpHost: string;
};

export type CreateAccountInput = Omit<Account, "id">;

export type MailConnectionInput = {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  username: string;
  password: string;
};

export type MailConnectionStatus = {
  mailboxes: string[];
  smtpReady: boolean;
};

export type SyncAccountStatus = {
  mailboxCount: number;
  messageCount: number;
};

export type CachedMailbox = {
  path: string;
  unreadCount: number;
};

export type CachedMessage = {
  uid: number;
  sender: string;
  subject: string;
  date: string;
  isRead: boolean;
};

export type MessageBody = {
  text: string;
  html: string | null;
  attachments: AttachmentMetadata[];
};

export type AttachmentMetadata = {
  name: string;
  mimeType: string;
  size: number;
};

export async function listAccounts(): Promise<Account[]> {
  if (!isTauri()) {
    return [];
  }

  return invoke<Account[]>("list_accounts");
}

export async function createAccount(input: CreateAccountInput): Promise<Account> {
  if (!isTauri()) {
    throw new Error("Account setup is available in the desktop application.");
  }

  return invoke<Account>("create_account", { input });
}

export async function deleteAccount(accountId: number): Promise<void> {
  if (!isTauri()) {
    throw new Error("Account setup is available in the desktop application.");
  }

  return invoke<void>("delete_account", { accountId });
}

export async function testMailConnection(input: MailConnectionInput): Promise<MailConnectionStatus> {
  if (!isTauri()) {
    throw new Error("Connection testing is available in the desktop application.");
  }

  return invoke<MailConnectionStatus>("test_mail_connection", { input });
}

export async function syncAccount(accountId: number, password: string): Promise<SyncAccountStatus> {
  return invoke<SyncAccountStatus>("sync_account", {
    input: { accountId, password },
  });
}

export async function listCachedMailboxes(accountId: number): Promise<CachedMailbox[]> {
  return invoke<CachedMailbox[]>("list_cached_mailboxes", { accountId });
}

export async function listCachedMessages(
  accountId: number,
  mailboxPath: string,
): Promise<CachedMessage[]> {
  return invoke<CachedMessage[]>("list_cached_messages", {
    input: { accountId, mailboxPath },
  });
}

export async function loadMessageBody(
  accountId: number,
  mailboxPath: string,
  uid: number,
  password: string,
): Promise<MessageBody> {
  return invoke<MessageBody>("load_message_body", {
    input: { accountId, mailboxPath, uid, password },
  });
}
