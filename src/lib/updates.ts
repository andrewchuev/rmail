import { invoke } from "@tauri-apps/api/core";

export type UpdateInfo = {
  version: string;
  url: string;
};

export function checkForUpdate(): Promise<UpdateInfo | null> {
  return invoke<UpdateInfo | null>("check_for_update");
}

export function openReleasePage(url: string): Promise<void> {
  return invoke<void>("open_release_page", { url });
}
