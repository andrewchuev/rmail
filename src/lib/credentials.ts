import { invoke, isTauri } from "@tauri-apps/api/core";

type CredentialName = "imapPassword" | "smtpPassword";

export async function saveCredentials(
  accountId: number,
  password: string,
) {
  if (!isTauri()) return;
  await invoke("save_credentials", { accountId, password });
}

export async function readCredential(
  accountId: number,
  name: CredentialName,
): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>("read_credential", { accountId, name });
}

export async function deleteCredentials(accountId: number): Promise<void> {
  if (!isTauri()) return;
  await invoke("delete_credentials", { accountId });
}
