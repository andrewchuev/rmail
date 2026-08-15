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
