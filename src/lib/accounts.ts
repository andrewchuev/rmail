import { invoke, isTauri } from "@tauri-apps/api/core";

export type Account = {
  id: number;
  email: string;
  displayName: string;
  imapHost: string;
  smtpHost: string;
  authType: "password" | "gmail_oauth";
  notificationsEnabled: boolean;
};

export type CreateAccountInput = Omit<Account, "id" | "authType" | "notificationsEnabled">;
export type UpdateAccountInput = Omit<Account, "authType" | "notificationsEnabled">;

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
  accountId: number;
  accountDisplayName: string;
  mailboxPath: string;
  uid: number;
  sender: string;
  senderEmail: string;
  subject: string;
  date: string;
  internalDate: number;
  isRead: boolean;
};

export type NotificationExclusion = {
  id: number;
  sender: string;
};

export type MessageBody = {
  text: string;
  html: string | null;
  attachments: AttachmentMetadata[];
};

export type AttachmentMetadata = {
  position: number;
  name: string;
  mimeType: string;
  size: number;
};

export type Draft = {
  id: number;
  recipients: string;
  subject: string;
  body: string;
  updatedAt: string;
};

export type DraftInput = {
  id: number | null;
  accountId: number;
  recipients: string;
  subject: string;
  body: string;
};

export type OutgoingMessageInput = Omit<DraftInput, "id" | "accountId">;

export async function listAccounts(): Promise<Account[]> {
  if (!isTauri()) {
    return [];
  }

  return invoke<Account[]>("list_accounts");
}

export async function diagnosticLogPath(): Promise<string> {
  return invoke<string>("diagnostic_log_path");
}

export async function saveMessageAttachment(
  accountId: number,
  mailboxPath: string,
  uid: number,
  attachmentPosition: number,
  destination: string,
): Promise<number> {
  return invoke<number>("save_message_attachment", {
    input: { accountId, mailboxPath, uid, attachmentPosition, destination },
  });
}

export async function createAccount(input: CreateAccountInput): Promise<Account> {
  if (!isTauri()) {
    throw new Error("Account setup is available in the desktop application.");
  }

  return invoke<Account>("create_account", { input });
}

export async function saveDraft(input: DraftInput): Promise<Draft> {
  return invoke<Draft>("save_draft", { input });
}

export async function deleteDraft(draftId: number): Promise<void> {
  return invoke<void>("delete_draft", { draftId });
}

export async function sendMessage(
  accountId: number,
  message: OutgoingMessageInput,
): Promise<void> {
  return invoke<void>("send_message", { input: { accountId, message } });
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

export async function syncAccount(accountId: number): Promise<SyncAccountStatus> {
  return invoke<SyncAccountStatus>("sync_account", {
    input: { accountId },
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

export async function updateAccount(input: UpdateAccountInput): Promise<Account> {
  return invoke<Account>("update_account", { input });
}

export async function connectGmail(): Promise<Account> {
  if (!isTauri()) {
    throw new Error("Gmail setup is available in the desktop application.");
  }

  return invoke<Account>("connect_gmail");
}

export async function reconnectGmail(accountId: number): Promise<Account> {
  return invoke<Account>("reconnect_gmail", { accountId });
}

export async function listUnifiedInbox(): Promise<CachedMessage[]> {
  return invoke<CachedMessage[]>("list_unified_inbox");
}

export async function loadMessageBody(
  accountId: number,
  mailboxPath: string,
  uid: number,
): Promise<MessageBody> {
  return invoke<MessageBody>("load_message_body", {
    input: { accountId, mailboxPath, uid },
  });
}

export type MessageRef = {
  accountId: number;
  mailboxPath: string;
  uid: number;
};

export async function markMessageRead(input: MessageRef): Promise<void> {
  return invoke<void>("mark_message_read", { input });
}

export async function markMultipleMessagesRead(messages: MessageRef[]): Promise<void> {
  return invoke<void>("mark_multiple_messages_read", { messages });
}

export async function deleteMessages(messages: MessageRef[]): Promise<void> {
  return invoke<void>("delete_messages", { messages });
}

export async function renameAccount(accountId: number, displayName: string): Promise<Account> {
  return invoke<Account>("rename_account", { accountId, displayName });
}

export async function setAccountNotifications(accountId: number, enabled: boolean): Promise<Account> {
  return invoke<Account>("set_account_notifications", { accountId, enabled });
}

export async function setTrayUnreadState(hasUnread: boolean): Promise<void> {
  return invoke<void>("set_tray_unread_state", { hasUnread });
}

export async function flushMessageCache(): Promise<void> {
  return invoke<void>("flush_message_cache");
}

export async function listNotificationExclusions(): Promise<NotificationExclusion[]> {
  return invoke<NotificationExclusion[]>("list_notification_exclusions");
}

export async function addNotificationExclusion(sender: string): Promise<NotificationExclusion> {
  return invoke<NotificationExclusion>("add_notification_exclusion", { sender });
}

export async function removeNotificationExclusion(id: number): Promise<void> {
  return invoke<void>("remove_notification_exclusion", { id });
}
