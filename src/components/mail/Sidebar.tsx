import { ChevronRight, Inbox, PenLine, Plus, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Account, CachedMailbox } from "@/lib/accounts";
import { folderLabel } from "@/lib/utils";
import { IconButton } from "./IconButton";

export function Sidebar({
  accountList,
  activeAccountId,
  activeFolder,
  isSyncing,
  mailboxes,
  onAddAccount,
  onCompose,
  onOpenSettings,
  onSelectAllInboxes,
  onSelectFolder,
  onSyncAll,
  onToggleAccount,
}: {
  accountList: Account[];
  activeAccountId: number | null;
  activeFolder: string;
  isSyncing: boolean;
  mailboxes: CachedMailbox[];
  onAddAccount: () => void;
  onCompose: () => void;
  onOpenSettings: () => void;
  onSelectAllInboxes: () => void;
  onSelectFolder: (path: string) => void;
  onSyncAll: () => void;
  onToggleAccount: (accountId: number, isExpanded: boolean) => void;
}) {
  return (
    <aside className="flex h-full min-w-52 flex-col border-r bg-sidebar px-3 py-4">
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-2 p-1 text-sm font-semibold">
          <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
            R
          </span>
          RMail
        </div>
        <div className="flex gap-1">
          <IconButton label="Settings" onClick={onOpenSettings}>
            <Settings />
          </IconButton>
          <IconButton label="Add account" onClick={onAddAccount}>
            <Plus />
          </IconButton>
        </div>
      </div>

      <Button className="mt-6 w-full justify-start" onClick={onCompose}>
        <PenLine />
        Compose
      </Button>

      <Button className="mt-2 w-full" disabled={isSyncing} onClick={onSyncAll} size="sm" variant="secondary">
        {isSyncing ? "Synchronizing…" : "Synchronize all"}
      </Button>

      <nav aria-label="Mail folders" className="mt-6 space-y-1">
        <button
          aria-current={activeAccountId === null ? "page" : undefined}
          className="folder-link"
          data-active={activeAccountId === null}
          onClick={onSelectAllInboxes}
          type="button"
        >
          <Inbox className="size-4" />
          <span>All inboxes</span>
        </button>
        <p className="px-2 pt-4 text-xs font-medium text-muted-foreground">Accounts</p>
        {accountList.map((account) => {
          const isExpanded = activeAccountId === account.id;
          return (
            <div key={account.id}>
              <button
                aria-expanded={isExpanded}
                className="folder-link"
                data-active={isExpanded}
                onClick={() => onToggleAccount(account.id, isExpanded)}
                type="button"
              >
                <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                <span className="truncate">{account.displayName}</span>
              </button>
              {isExpanded ? (
                <div className="ml-4 mt-1 space-y-1 border-l pl-2">
                  {mailboxes.map((mailbox) => (
                    <button
                      aria-current={activeFolder === mailbox.path ? "page" : undefined}
                      className="folder-link"
                      data-active={activeFolder === mailbox.path}
                      key={`${account.id}:${mailbox.path}`}
                      onClick={() => onSelectFolder(mailbox.path)}
                      type="button"
                    >
                      <Inbox className="size-4" />
                      <span>{folderLabel(mailbox.path)}</span>
                      {mailbox.unreadCount ? <span className="ml-auto text-xs tabular-nums">{mailbox.unreadCount}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
