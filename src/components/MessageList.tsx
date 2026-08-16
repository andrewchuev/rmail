import { ScrollArea } from "@/components/ui/scroll-area";
import { type CachedMessage } from "@/lib/accounts";
import { folderLabel, messageKey } from "@/lib/mail-utils";

export interface MessageListProps {
  visibleMessages: CachedMessage[];
  layoutMode: "default" | "compact";
  selectedMessageKey: string | null;
  onSelectMessage: (key: string) => void;
  query: string;
}

export function MessageList({
  visibleMessages,
  layoutMode,
  selectedMessageKey,
  onSelectMessage,
  query,
}: MessageListProps) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="p-2">
        {visibleMessages.length ? (
          visibleMessages.map((message) => (
            <button
              className="message-row"
              data-selected={selectedMessageKey === messageKey(message)}
              key={messageKey(message)}
              onClick={() => onSelectMessage(messageKey(message))}
              type="button"
            >
              <div className={`flex ${layoutMode === "compact" ? "items-center gap-4" : "items-start gap-3"}`}>
                <span className={`size-2 shrink-0 rounded-full bg-primary opacity-0 data-[unread=true]:opacity-100 ${layoutMode === "compact" ? "" : "mt-1"}`} data-unread={!message.isRead} />
                {layoutMode === "compact" ? (
                  <div className="min-w-0 flex-1 flex items-center gap-4 text-left">
                    <p className={`w-64 shrink-0 truncate text-sm ${!message.isRead ? "font-bold text-foreground" : "font-normal text-foreground/80"}`}>{message.sender}</p>
                    <p className={`flex-1 truncate text-sm ${!message.isRead ? "font-bold text-foreground" : "font-normal text-foreground/80"}`}>
                      {message.subject} <span className="text-muted-foreground font-normal ml-2">&middot; {message.accountDisplayName} &middot; {folderLabel(message.mailboxPath)}</span>
                    </p>
                    <time className={`shrink-0 text-xs ${!message.isRead ? "font-bold text-foreground" : "text-muted-foreground"}`}>{message.date}</time>
                  </div>
                ) : (
                  <div className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-3">
                      <p className={`truncate text-sm ${!message.isRead ? "font-bold text-foreground" : "font-medium text-foreground/80"}`}>{message.sender}</p>
                      <time className={`ml-auto text-xs ${!message.isRead ? "font-bold text-foreground" : "text-muted-foreground"}`}>{message.date}</time>
                    </div>
                    <p className={`mt-1 truncate text-sm ${!message.isRead ? "font-bold text-foreground" : "font-normal text-foreground/80"}`}>{message.subject}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{message.accountDisplayName} &middot; {folderLabel(message.mailboxPath)}</p>
                  </div>
                )}
              </div>
            </button>
          ))
        ) : (
          <div className="grid min-h-48 place-items-center px-8 text-center text-sm text-muted-foreground">
            {query ? "No messages found. Try another search." : "This folder has no synchronized messages yet."}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
