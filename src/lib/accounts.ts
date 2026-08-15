import { invoke, isTauri } from "@tauri-apps/api/core";

export type Account = {
  id: number;
  email: string;
  displayName: string;
  imapHost: string;
  smtpHost: string;
};

export type CreateAccountInput = Omit<Account, "id">;

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
