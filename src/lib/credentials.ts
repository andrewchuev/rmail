import { appDataDir } from "@tauri-apps/api/path";
import { Client, Stronghold } from "@tauri-apps/plugin-stronghold";

const clientName = "rmail";
const vaultFileName = "credentials.hold";

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

function credentialKey(accountId: number, name: "imapPassword" | "smtpPassword") {
  return `account:${accountId}:${name}`;
}

export async function saveCredential(
  accountId: number,
  name: "imapPassword" | "smtpPassword",
  value: string,
  masterPassword: string,
) {
  const { client, stronghold } = await openVault(masterPassword);
  const store = client.getStore();
  const key = credentialKey(accountId, name);

  await store.insert(key, Array.from(new TextEncoder().encode(value)));
  await stronghold.save();
}

export async function readCredential(
  accountId: number,
  name: "imapPassword" | "smtpPassword",
  masterPassword: string,
) {
  const { client } = await openVault(masterPassword);
  const value = await client.getStore().get(credentialKey(accountId, name));

  if (!value) {
    return null;
  }

  return new TextDecoder().decode(new Uint8Array(value));
}
