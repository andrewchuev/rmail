import { appDataDir } from "@tauri-apps/api/path";
import { Client, Stronghold } from "@tauri-apps/plugin-stronghold";

const clientName = "rmail";
const vaultFileName = "credentials.hold";
type CredentialName = "imapPassword" | "smtpPassword";

async function openVault(masterPassword: string) {
  if (!masterPassword) {
    throw new Error("A vault password is required.");
  }

  const vaultPath = `${await appDataDir()}/${vaultFileName}`;
  const stronghold = await Stronghold.load(vaultPath, masterPassword);

  let client: Client;
  try {
    client = await stronghold.loadClient(clientName);
  } catch {
    client = await stronghold.createClient(clientName);
  }

  return { client, stronghold };
}

function credentialKey(accountId: number, name: CredentialName) {
  return `account:${accountId}:${name}`;
}

export async function saveCredentials(
  accountId: number,
  password: string,
  masterPassword: string,
) {
  const { client, stronghold } = await openVault(masterPassword);
  const store = client.getStore();
  const encodedPassword = Array.from(new TextEncoder().encode(password));

  await store.insert(credentialKey(accountId, "imapPassword"), encodedPassword);
  await store.insert(credentialKey(accountId, "smtpPassword"), encodedPassword);
  await stronghold.save();
}

export async function readCredential(
  accountId: number,
  name: CredentialName,
  masterPassword: string,
): Promise<string | null> {
  const { client } = await openVault(masterPassword);
  const value = await client.getStore().get(credentialKey(accountId, name));

  if (!value) {
    return null;
  }

  return new TextDecoder().decode(new Uint8Array(value));
}

export async function deleteCredentials(accountId: number, masterPassword: string): Promise<void> {
  const { client, stronghold } = await openVault(masterPassword);
  const store = client.getStore();

  await Promise.all([
    store.remove(credentialKey(accountId, "imapPassword")),
    store.remove(credentialKey(accountId, "smtpPassword")),
  ]);
  await stronghold.save();
}
