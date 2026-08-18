import type { ReactNode } from "react";
import { BellOff, CheckCheck, CheckSquare, Reply, Search, Trash2, X } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CachedMessage } from "@/lib/accounts";
import { folderLabel, messageKey } from "@/lib/utils";
import { IconButton } from "./IconButton";

export function MessageListHeader({
  accountName,
  onMarkAllRead,
  onQueryChange,
  query,
  title,
  toggleModeButton,
}: {
  accountName?: string;
  onMarkAllRead: () => void;
  onQueryChange: (value: string) => void;
  query: string;
  title: string;
  toggleModeButton: ReactNode;
}) {
  return (
    <header className="border-b px-5 py-4">
      <div className="flex items-center justify-between">
        <div>
          {accountName ? <p className="text-xs font-medium text-muted-foreground">{accountName}</p> : null}
          <h1 className="mt-0.5 text-lg font-semibold">{title}</h1>
        </div>
        <div className="flex gap-1">
          <IconButton label="Mark all as read" onClick={onMarkAllRead}>
            <CheckCheck />
          </IconButton>
          {toggleModeButton}
        </div>
      </div>
      <label className="search-field mt-4">
        <Search className="size-4" />
        <span className="sr-only">Search messages</span>
        <input
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search"
          type="search"
          value={query}
        />
      </label>
    </header>
  );
}

export function MessageList({
  excludedSenderEmails,
  layoutMode,
  messages,
  onBulkDelete,
  onBulkMarkRead,
  onClearSelection,
  onDeleteMessage,
  onExcludeSender,
  onReply,
  onSelectFromSender,
  onSelectMessage,
  onToggleMessageSelection,
  onToggleSelectAll,
  query,
  selectedMessageKey,
  selectedMessageKeys,
}: {
  excludedSenderEmails: Set<string>;
  layoutMode: "default" | "compact";
  messages: CachedMessage[];
  onBulkDelete: () => void;
  onBulkMarkRead: () => void;
  onClearSelection: () => void;
  onDeleteMessage: (message: CachedMessage) => void;
  onExcludeSender: (message: CachedMessage) => void;
  onReply: (message: CachedMessage) => void;
  onSelectFromSender: (message: CachedMessage) => void;
  onSelectMessage: (message: CachedMessage) => void;
  onToggleMessageSelection: (key: string, checked: boolean) => void;
  onToggleSelectAll: (checked: boolean) => void;
  query: string;
  selectedMessageKey: string | null;
  selectedMessageKeys: Set<string>;
}) {
  const selectedInView = messages.filter((message) => selectedMessageKeys.has(messageKey(message)));
  const allVisibleSelected = messages.length > 0 && selectedInView.length === messages.length;

  return (
    <ScrollArea className="min-h-0 flex-1">
      {selectedInView.length > 0 ? (
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/95 px-4 py-2 backdrop-blur">
          <input
            aria-label="Select all visible messages"
            checked={allVisibleSelected}
            className="size-4 accent-primary"
            onChange={(event) => onToggleSelectAll(event.target.checked)}
            type="checkbox"
          />
          <span className="text-sm font-medium">{selectedInView.length} selected</span>
          <div className="ml-auto flex gap-1">
            <IconButton label="Mark as read" onClick={onBulkMarkRead}>
              <CheckCheck />
            </IconButton>
            <IconButton label="Delete" onClick={onBulkDelete}>
              <Trash2 />
            </IconButton>
            <IconButton label="Clear selection" onClick={onClearSelection}>
              <X />
            </IconButton>
          </div>
        </div>
      ) : null}
      <div className="p-2">
        {messages.length ? (
          messages.map((message) => {
            const key = messageKey(message);
            const isChecked = selectedMessageKeys.has(key);
            const isSenderExcluded = excludedSenderEmails.has(message.senderEmail.toLowerCase());
            return (
              <ContextMenu key={key}>
                <ContextMenuTrigger asChild>
                  <div className="group/row flex items-center gap-1">
                    <span className={`shrink-0 pl-1.5 transition-opacity ${selectedInView.length > 0 || isChecked ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"}`}>
                      <input
                        aria-label={`Select message from ${message.sender}`}
                        checked={isChecked}
                        className="size-4 accent-primary"
                        onChange={(event) => onToggleMessageSelection(key, event.target.checked)}
                        type="checkbox"
                      />
                    </span>
                    <button
                      className="message-row flex-1"
                      data-selected={selectedMessageKey === key}
                      onClick={() => onSelectMessage(message)}
                      type="button"
                    >
                      <div className={`flex ${layoutMode === "compact" ? "items-center gap-4" : "items-start gap-3"}`}>
                        <span className={`size-2 shrink-0 rounded-full bg-primary opacity-0 data-[unread=true]:opacity-100 ${layoutMode === "compact" ? "" : "mt-1"}`} data-unread={!message.isRead} />
                        {layoutMode === "compact" ? (
                          <div className="min-w-0 flex-1 flex items-center gap-4 text-left">
                            <p className={`w-64 shrink-0 truncate text-sm ${!message.isRead ? "font-semibold text-foreground/90" : "font-normal text-foreground/70"}`}>
                              {message.sender}
                              {isSenderExcluded ? <BellOff className="ml-1.5 inline size-3 text-muted-foreground" /> : null}
                            </p>
                            <p className={`flex-1 truncate text-sm ${!message.isRead ? "font-semibold text-foreground/90" : "font-normal text-foreground/70"}`}>
                              {message.subject} <span className="text-muted-foreground font-normal ml-2">&middot; {message.accountDisplayName} &middot; {folderLabel(message.mailboxPath)}</span>
                            </p>
                            <time className={`shrink-0 text-xs ${!message.isRead ? "font-semibold text-foreground/90" : "text-muted-foreground"}`}>{message.date}</time>
                          </div>
                        ) : (
                          <div className="min-w-0 flex-1 text-left">
                            <div className="flex items-center gap-3">
                              <p className={`truncate text-sm ${!message.isRead ? "font-semibold text-foreground/90" : "font-medium text-foreground/70"}`}>
                                {message.sender}
                                {isSenderExcluded ? <BellOff className="ml-1.5 inline size-3 text-muted-foreground" /> : null}
                              </p>
                              <time className={`ml-auto text-xs ${!message.isRead ? "font-semibold text-foreground/90" : "text-muted-foreground"}`}>{message.date}</time>
                            </div>
                            <p className={`mt-1 truncate text-sm ${!message.isRead ? "font-semibold text-foreground/90" : "font-normal text-foreground/70"}`}>{message.subject}</p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">{message.accountDisplayName} &middot; {folderLabel(message.mailboxPath)}</p>
                          </div>
                        )}
                      </div>
                    </button>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => onReply(message)}>
                    <Reply /> Reply
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => onSelectFromSender(message)}>
                    <CheckSquare /> Select from sender
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={isSenderExcluded}
                    onSelect={() => onExcludeSender(message)}
                  >
                    <BellOff /> {isSenderExcluded ? "Notifications already excluded" : "Exclude from notifications"}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => onDeleteMessage(message)} variant="destructive">
                    <Trash2 /> Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })
        ) : (
          <div className="grid min-h-48 place-items-center px-8 text-center text-sm text-muted-foreground">
            {query ? "No messages found. Try another search." : "This folder has no synchronized messages yet."}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
