import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Archive, ArrowLeft, ChevronRight, Clock3, CheckCheck, Inbox, LayoutTemplate, List, Paperclip, PenLine, Plus, Search, Settings, Trash2, X } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Button } from "@/components/ui/button";
import { AccountSetup } from "@/components/AccountSetup";
import { SettingsPage } from "@/components/SettingsPage";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  deleteDraft,
  deleteMessages,
  listAccounts,
  listCachedMailboxes,
  listCachedMessages,
  listUnifiedInbox,
  loadMessageBody,
  markMessageRead,
  markMultipleMessagesRead,
  saveMessageAttachment,
  saveDraft,
  sendMessage,
  setTrayUnreadState,
  syncAccount,
  type Account,
  type CachedMailbox,
  type CachedMessage,
  type Draft,
  type MessageBody,
  type MessageRef,
} from "@/lib/accounts";
import { applyWindowSettings, loadBackgroundSettings, saveBackgroundSettings, type BackgroundSettings } from "@/lib/settings";
import "./App.css";
import { folderLabel, attachmentFileName, messageKey, cachedMessagesEqual, cachedMailboxesEqual, wrapEmailHtml } from "@/lib/utils";













type ComposeState = {
  recipients: string;
  subject: string;
  body: string;
};

const emptyCompose: ComposeState = { recipients: "", subject: "", body: "" };

function IconButton({
  label,
  children,
  onClick,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} onClick={onClick} size="icon" variant="ghost">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function App() {
  const [, startTransition] = useTransition();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mailboxes, setMailboxes] = useState<CachedMailbox[]>([]);


  const [cachedMessages, setCachedMessages] = useState<CachedMessage[]>([]);
  const [layoutMode, setLayoutMode] = useState<"default" | "compact">("default");
  const layoutModeRef = useRef(layoutMode);
  layoutModeRef.current = layoutMode;
  const [activeAccountId, setActiveAccountId] = useState<number | null>(null);
  const [activeFolder, setActiveFolder] = useState("INBOX");
  const [selectedMessageKey, setSelectedMessageKey] = useState<string | null>(null);
  const [selectedMessageKeys, setSelectedMessageKeys] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [isComposeOpen, setComposeOpen] = useState(false);
  const [compose, setCompose] = useState<ComposeState>(emptyCompose);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [composeMessage, setComposeMessage] = useState<string | null>(null);
  const [isSavingDraft, setSavingDraft] = useState(false);
  const [isSending, setSending] = useState(false);
  const [syncMessage, setSyncMessage] = useState("Synchronization pending");
  const [syncRevision, setSyncRevision] = useState(0);
  useEffect(() => {
    const notifiableAccountIds = new Set((accounts ?? []).filter((a) => a.notificationsEnabled).map((a) => a.id));
    listUnifiedInbox().then((inbox) => {
      // If we just clicked a message, cachedMessages might have local optimistic updates not in DB yet
      // So let's count optimistic unread statuses as well!
      let unreadCount = 0;
      for (const msg of inbox) {
        if (!notifiableAccountIds.has(msg.accountId)) continue;
        const cached = cachedMessages.find(m => m.uid === msg.uid && m.accountId === msg.accountId);
        if (cached) {
            if (!cached.isRead) unreadCount++;
        } else {
            if (!msg.isRead) unreadCount++;
        }
      }
      setTrayUnreadState(unreadCount > 0).catch(console.error);
    }).catch(console.error);
  }, [syncRevision, cachedMessages, accounts]);
  const [messageBody, setMessageBody] = useState<MessageBody | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [isBodyLoading, setBodyLoading] = useState(false);
  const [contentMode, setContentMode] = useState<"text" | "html">("text");
  const [savingAttachmentPosition, setSavingAttachmentPosition] = useState<number | null>(null);
  const [attachmentMessage, setAttachmentMessage] = useState<string | null>(null);
  const [isAddingAccount, setAddingAccount] = useState(false);
  const [isSyncing, setSyncing] = useState(false);
  const [composeAccountId, setComposeAccountId] = useState<number | null>(null);
  const [backgroundSettings, setBackgroundSettings] = useState<BackgroundSettings>(loadBackgroundSettings);
  const [activeView, setActiveView] = useState<"mail" | "settings">("mail");
  const hasCompletedBackgroundSync = useRef(false);
  const knownMessageKeys = useRef<Set<string>>(new Set());
  const syncInProgress = useRef(false);
  const htmlFrameRef = useRef<HTMLIFrameElement>(null);

  // Keeps the HTML message iframe sized to fit its content so the outer pane
  // is the only scroll container. A one-off measurement on "load" isn't
  // enough: images without explicit width/height grow the document after
  // load finishes, which would otherwise leave the iframe too short and
  // produce a second, inner scrollbar. A ResizeObserver on the iframe's own
  // document keeps the height in sync as content (images, fonts) settles.
  useEffect(() => {
    const frame = htmlFrameRef.current;
    if (!frame || contentMode !== "html" || !messageBody?.html) {
      return;
    }

    let observer: ResizeObserver | undefined;

    const syncHeight = () => {
      const root = frame.contentDocument?.documentElement;
      if (root) {
        frame.style.height = `${root.scrollHeight}px`;
      }
    };

    const handleLoad = () => {
      observer?.disconnect();
      const root = frame.contentDocument?.documentElement;
      if (!root) return;
      syncHeight();
      observer = new ResizeObserver(syncHeight);
      observer.observe(root);
    };

    if (frame.contentDocument?.readyState === "complete") {
      handleLoad();
    }
    frame.addEventListener("load", handleLoad);

    return () => {
      frame.removeEventListener("load", handleLoad);
      observer?.disconnect();
    };
  }, [contentMode, messageBody?.html]);

  const visibleMessages = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return cachedMessages;
    }

    return cachedMessages.filter((message) =>
      [message.sender, message.subject]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [cachedMessages, query]);

  const selectedInView = useMemo(
    () => visibleMessages.filter((message) => selectedMessageKeys.has(messageKey(message))),
    [visibleMessages, selectedMessageKeys],
  );

  function toggleMessageSelection(key: string, checked: boolean) {
    setSelectedMessageKeys((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }

  function messageRefs(messages: CachedMessage[]): MessageRef[] {
    return messages.map((message) => ({
      accountId: message.accountId,
      mailboxPath: message.mailboxPath,
      uid: message.uid,
    }));
  }

  function removeMessagesFromCache(messages: CachedMessage[]) {
    const keys = new Set(messages.map(messageKey));
    setCachedMessages((current) => current.filter((message) => !keys.has(messageKey(message))));
    if (selectedMessageKey && keys.has(selectedMessageKey)) {
      setSelectedMessageKey(null);
    }
  }

  function handleBulkMarkRead() {
    const targets = selectedInView.filter((message) => !message.isRead);
    setSelectedMessageKeys(new Set());
    if (!targets.length) return;

    setCachedMessages((current) => {
      const keys = new Set(targets.map(messageKey));
      return current.map((message) => (keys.has(messageKey(message)) ? { ...message, isRead: true } : message));
    });
    markMultipleMessagesRead(messageRefs(targets)).catch((reason) => {
      console.error("Unable to mark the selected messages as read:", reason);
    });
  }

  function handleBulkDelete() {
    const targets = selectedInView;
    setSelectedMessageKeys(new Set());
    if (!targets.length) return;

    removeMessagesFromCache(targets);
    deleteMessages(messageRefs(targets)).catch((reason) => {
      console.error("Unable to delete the selected messages:", reason);
    });
  }

  function handleDeleteMessage(message: CachedMessage) {
    removeMessagesFromCache([message]);
    deleteMessages(messageRefs([message])).catch((reason) => {
      console.error("Unable to delete the message:", reason);
    });
  }

  const selectedMessage = cachedMessages.find(
    (message) => messageKey(message) === selectedMessageKey,
  ) ?? null;

  useEffect(() => {
    let ignore = false;

    void listAccounts()
      .then((items) => {
        if (!ignore) {
          setAccounts(items);
        }
      })
      .catch((reason) => {
        if (!ignore) {
          setLoadError(reason instanceof Error ? reason.message : "Unable to load accounts.");
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    saveBackgroundSettings(backgroundSettings);
    void applyWindowSettings(backgroundSettings).catch(() => undefined);
  }, [backgroundSettings]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("tray-show", () => {
      void getCurrentWindow().show().then(() => getCurrentWindow().setFocus());
    }).then((listener) => {
      unlisten = listener;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    let zoomLevel = parseFloat(localStorage.getItem("ui-zoom-level") ?? "1.0");
    const applyZoom = (z: number) => {
      zoomLevel = Math.max(0.2, Math.min(5.0, z));
      localStorage.setItem("ui-zoom-level", zoomLevel.toString());
      void getCurrentWebview().setZoom(zoomLevel);
    };

    // Restore on mount
    if (zoomLevel !== 1.0) {
      applyZoom(zoomLevel);
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          applyZoom(zoomLevel + 0.1);
        } else if (e.key === "-") {
          e.preventDefault();
          applyZoom(zoomLevel - 0.1);
        } else if (e.key === "0") {
          e.preventDefault();
          applyZoom(1.0);
        }
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        applyZoom(zoomLevel - (e.deltaY > 0 ? 0.1 : -0.1));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("wheel", handleWheel);
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("tray-sync", () => void syncAllAccounts()).then((listener) => {
      unlisten = listener;
    });
    return () => unlisten?.();
  }, [accounts, backgroundSettings]);

  useEffect(() => {
    setSelectedMessageKeys(new Set());
  }, [activeAccountId, activeFolder]);

  useEffect(() => {
    if (activeAccountId === null) {
      setMailboxes([]);
      return;
    }
    const account = accounts?.find((item) => item.id === activeAccountId);
    if (!account) return;
    let ignore = false;

    void listCachedMailboxes(account.id)
      .then((items) => {
        if (ignore) {
          return;
        }
        startTransition(() => {
          setMailboxes((current) => cachedMailboxesEqual(current, items) ? current : items);
          setActiveFolder((current) => items.some((mailbox) => mailbox.path === current) ? current : (items[0]?.path ?? "INBOX"));
        });
      })
      .catch(() => {
        if (!ignore) {
          setSyncMessage("Unable to load the local cache");
        }
      });

    return () => {
      ignore = true;
    };
  }, [accounts, activeAccountId, syncRevision]);

  useEffect(() => {
    if (!accounts?.length) {
      return;
    }
    let ignore = false;

    const loadMessages = activeAccountId === null
      ? listUnifiedInbox()
      : listCachedMessages(activeAccountId, activeFolder);
    void loadMessages
      .then((items) => {
        if (ignore) {
          return;
        }
        startTransition(() => {
          setCachedMessages((current) => cachedMessagesEqual(current, items) ? current : items);
          setSelectedMessageKey((current) => current && items.some((message) => messageKey(message) === current)
            ? current
            : (layoutModeRef.current === "default" && items[0] ? messageKey(items[0]) : null));
        });
      })
      .catch(() => {
        if (!ignore) {
          setSyncMessage("Unable to load messages from the cache");
        }
      });

    return () => {
      ignore = true;
    };
  }, [accounts, activeAccountId, activeFolder, syncRevision]);

  useEffect(() => {
    const message = selectedMessage;
    const account = message ? accounts?.find((item) => item.id === message.accountId) : null;
    if (!account || !message) {
      setMessageBody(null);
      setBodyError(null);
      setBodyLoading(false);
      return;
    }
    let ignore = false;

    setMessageBody(null);
    setBodyLoading(true);
    setBodyError(null);
    setContentMode("text");
    setAttachmentMessage(null);
    void loadMessageBody(account.id, message.mailboxPath, message.uid)
      .then((body) => {
        if (!ignore) {
          setMessageBody(body);
          setContentMode(body.html ? "html" : "text");
        }
      })
      .catch((reason) => {
        if (!ignore) {
          setBodyError(reason instanceof Error ? reason.message : "Unable to load the message.");
        }
      })
      .finally(() => {
        if (!ignore) {
          setBodyLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [accounts, selectedMessageKey]);

  useEffect(() => {
    if (
      !backgroundSettings.enabled
      || !accounts?.length
    ) return;
    const timer = window.setInterval(() => void syncAllAccounts(true), backgroundSettings.intervalMinutes * 60_000);
    return () => window.clearInterval(timer);
  }, [accounts, backgroundSettings]);

  if (loadError) {
    return <main className="grid min-h-svh place-items-center p-6 text-sm text-destructive">{loadError}</main>;
  }

  if (!accounts) {
    return <main className="grid min-h-svh place-items-center text-sm text-muted-foreground">Loading settings…</main>;
  }

  if (accounts.length === 0 || isAddingAccount) {
    return (
      <AccountSetup
        isAdditional={accounts.length > 0}
        onCancel={accounts.length > 0 ? () => setAddingAccount(false) : undefined}
        onGmailConnected={async (account) => {
          setAccounts((current) => [...(current ?? []), account]);
          setActiveAccountId(account.id);
          setActiveFolder("INBOX");
          setAddingAccount(false);
          try {
            const status = await syncAccount(account.id);
            setSyncMessage(`Synchronized: ${status.mailboxCount} mailboxes, ${status.messageCount} messages`);
            setSyncRevision((current) => current + 1);
          } catch (reason) {
            setSyncMessage(reason instanceof Error ? reason.message : String(reason || "Gmail was connected, but the initial synchronization failed"));
          }
        }}
        onAccountCreated={async (account) => {
          setAccounts((current) => [...(current ?? []), account]);
          setActiveAccountId(account.id);
          setActiveFolder("INBOX");
          setAddingAccount(false);

          try {
            const status = await syncAccount(account.id);
            setSyncMessage(`Synchronized: ${status.mailboxCount} mailboxes, ${status.messageCount} messages`);
            setSyncRevision((current) => current + 1);
          } catch {
            setSyncMessage("The account was saved, but the initial synchronization failed");
          }
        }}
      />
    );
  }

  const accountList = accounts;

  async function downloadAttachment(position: number, name: string) {
    const message = selectedMessage;
    const account = message ? accountList.find((item) => item.id === message.accountId) : null;
    if (!account || !message) {
      return;
    }

    setAttachmentMessage(null);
    const destination = await save({ defaultPath: attachmentFileName(name) });
    if (!destination) {
      return;
    }

    setSavingAttachmentPosition(position);
    try {
      await saveMessageAttachment(account.id, message.mailboxPath, message.uid, position, destination);
      setAttachmentMessage(`Attachment “${name}” was saved.`);
    } catch (reason) {
      setAttachmentMessage(reason instanceof Error ? reason.message : "Unable to save the attachment.");
    } finally {
      setSavingAttachmentPosition(null);
    }
  }

  function openCompose() {
    setCompose(emptyCompose);
    setDraftId(null);
    setComposeMessage(null);
    setComposeAccountId(activeAccountId ?? accountList[0]?.id ?? null);
    setComposeOpen(true);
  }

  async function saveComposeDraft(): Promise<Draft> {
    const account = accountList.find((item) => item.id === composeAccountId);
    if (!account) {
      throw new Error("Account not found.");
    }

    const draft = await saveDraft({ ...compose, accountId: account.id, id: draftId });
    setDraftId(draft.id);
    return draft;
  }

  async function handleSaveDraft() {
    setComposeMessage(null);
    setSavingDraft(true);
    try {
      await saveComposeDraft();
      setComposeMessage("Draft saved on this device.");
    } catch (reason) {
      setComposeMessage(reason instanceof Error ? reason.message : "Unable to save the draft.");
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const account = accountList.find((item) => item.id === composeAccountId);
    if (!account) {
      setComposeMessage("Unlock the vault to send the message.");
      return;
    }

    setComposeMessage(null);
    setSending(true);
    try {
      const draft = await saveComposeDraft();
      await sendMessage(account.id, compose);
      await deleteDraft(draft.id);
      setComposeOpen(false);
      setCompose(emptyCompose);
      setDraftId(null);
      setSyncMessage("Message sent through SMTP");
    } catch (reason) {
      setComposeMessage(reason instanceof Error ? reason.message : "Unable to send the message.");
    } finally {
      setSending(false);
    }
  }

  async function syncAllAccounts(isBackground = false) {
    if (syncInProgress.current) {
      return;
    }

    syncInProgress.current = true;
    if (!isBackground) setSyncing(true);
    try {
      const results = await Promise.allSettled(accountList.map((account) => syncAccount(account.id)));
      const successful = results.filter((result) => result.status === "fulfilled");
      const messageCount = successful.reduce(
        (count, result) => count + result.value.messageCount,
        0,
      );
      startTransition(() => setSyncRevision((current) => current + 1));
      const inbox = await listUnifiedInbox();
      const currentKeys = new Set(inbox.map(messageKey));
      const notifiableAccountIds = new Set(accountList.filter((a) => a.notificationsEnabled).map((a) => a.id));
      const newNotifiableCount = inbox.filter(
        (message) => !knownMessageKeys.current.has(messageKey(message)) && notifiableAccountIds.has(message.accountId),
      ).length;
      knownMessageKeys.current = currentKeys;
      if (isBackground && hasCompletedBackgroundSync.current && successful.length && backgroundSettings.notifications && newNotifiableCount) {
        const granted = await isPermissionGranted() || await requestPermission() === "granted";
        if (granted) sendNotification({ title: "RMail", body: `New messages: ${newNotifiableCount}.` });
      }
      hasCompletedBackgroundSync.current = true;
      const errors = results.map((result, i) => result.status === "rejected" ? `${accountList[i].displayName}: ${result.reason instanceof Error ? result.reason.message : String(result.reason || "Unknown error")}` : null).filter(Boolean);
      startTransition(() => setSyncMessage(
        errors.length === 0
          ? `Synchronized all ${successful.length} accounts, messages: ${messageCount}`
          : `Sync failed for ${errors.join("; ")}`
      ));
    } catch {
      if (!isBackground) setSyncMessage("Unable to update the local email cache");
    } finally {
      syncInProgress.current = false;
      if (!isBackground) setSyncing(false);
    }
  }

  async function handleCacheFlushed() {
    setCachedMessages([]);
    setMailboxes([]);
    setSelectedMessageKey(null);
    setSelectedMessageKeys(new Set());
    setSyncRevision((current) => current + 1);
    await syncAllAccounts();
  }

  if (activeView === "settings") {
    return (
      <SettingsPage
        accounts={accountList}
        backgroundSettings={backgroundSettings}
        onAccountUpdated={(updated) => setAccounts((current) => current?.map((account) => account.id === updated.id ? updated : account) ?? [])}
        onAddAccount={() => setAddingAccount(true)}
        onBack={() => setActiveView("mail")}
        onBackgroundSettingsChange={setBackgroundSettings}
        onCacheFlushed={handleCacheFlushed}
      />
    );
  }

  
  const handleMarkAllRead = () => {
    const unreadMessages = visibleMessages.filter((m) => !m.isRead);
    if (unreadMessages.length === 0) return;

    // Update local state immediately
    setCachedMessages((current) => {
      const keys = new Set(unreadMessages.map(messageKey));
      return current.map((m) => (keys.has(messageKey(m)) ? { ...m, isRead: true } : m));
    });

    markMultipleMessagesRead(messageRefs(unreadMessages)).catch((reason) => {
      console.error("Unable to mark all messages as read:", reason);
    });
  };

  const renderMessageList = () => {
    const allVisibleSelected = visibleMessages.length > 0 && selectedInView.length === visibleMessages.length;

    return (
      <ScrollArea className="min-h-0 flex-1">
        {selectedInView.length > 0 ? (
          <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/95 px-4 py-2 backdrop-blur">
            <input
              aria-label="Select all visible messages"
              checked={allVisibleSelected}
              className="size-4 accent-primary"
              onChange={(event) => setSelectedMessageKeys(event.target.checked ? new Set(visibleMessages.map(messageKey)) : new Set())}
              type="checkbox"
            />
            <span className="text-sm font-medium">{selectedInView.length} selected</span>
            <div className="ml-auto flex gap-1">
              <IconButton label="Mark as read" onClick={handleBulkMarkRead}>
                <CheckCheck />
              </IconButton>
              <IconButton label="Delete" onClick={handleBulkDelete}>
                <Trash2 />
              </IconButton>
              <IconButton label="Clear selection" onClick={() => setSelectedMessageKeys(new Set())}>
                <X />
              </IconButton>
            </div>
          </div>
        ) : null}
        <div className="p-2">
                    {visibleMessages.length ? (
                      visibleMessages.map((message) => {
                        const key = messageKey(message);
                        const isChecked = selectedMessageKeys.has(key);
                        return (
                          <div className="group/row flex items-center gap-1" key={key}>
                            <span className={`shrink-0 pl-1.5 transition-opacity ${selectedInView.length > 0 || isChecked ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"}`}>
                              <input
                                aria-label={`Select message from ${message.sender}`}
                                checked={isChecked}
                                className="size-4 accent-primary"
                                onChange={(event) => toggleMessageSelection(key, event.target.checked)}
                                type="checkbox"
                              />
                            </span>
                            <button
                              className="message-row flex-1"
                              data-selected={selectedMessageKey === key}
                              onClick={() => {
                                if (!message.isRead) {
                                  setCachedMessages((current) =>
                                    current.map((m) => (messageKey(m) === key ? { ...m, isRead: true } : m))
                                  );
                                  markMessageRead({
                                    accountId: message.accountId,
                                    mailboxPath: message.mailboxPath,
                                    uid: message.uid,
                                  }).catch(console.error);
                                }
                                setSelectedMessageKey(key);
                              }}
                              type="button"
                            >
                              <div className={`flex ${layoutMode === "compact" ? "items-center gap-4" : "items-start gap-3"}`}>
                                <span className={`size-2 shrink-0 rounded-full bg-primary opacity-0 data-[unread=true]:opacity-100 ${layoutMode === "compact" ? "" : "mt-1"}`} data-unread={!message.isRead} />
                                {layoutMode === "compact" ? (
                                  <div className="min-w-0 flex-1 flex items-center gap-4 text-left">
                                    <p className={`w-64 shrink-0 truncate text-sm ${!message.isRead ? "font-semibold text-foreground/90" : "font-normal text-foreground/70"}`}>{message.sender}</p>
                                    <p className={`flex-1 truncate text-sm ${!message.isRead ? "font-semibold text-foreground/90" : "font-normal text-foreground/70"}`}>
                                      {message.subject} <span className="text-muted-foreground font-normal ml-2">&middot; {message.accountDisplayName} &middot; {folderLabel(message.mailboxPath)}</span>
                                    </p>
                                    <time className={`shrink-0 text-xs ${!message.isRead ? "font-semibold text-foreground/90" : "text-muted-foreground"}`}>{message.date}</time>
                                  </div>
                                ) : (
                                  <div className="min-w-0 flex-1 text-left">
                                    <div className="flex items-center gap-3">
                                      <p className={`truncate text-sm ${!message.isRead ? "font-semibold text-foreground/90" : "font-medium text-foreground/70"}`}>{message.sender}</p>
                                      <time className={`ml-auto text-xs ${!message.isRead ? "font-semibold text-foreground/90" : "text-muted-foreground"}`}>{message.date}</time>
                                    </div>
                                    <p className={`mt-1 truncate text-sm ${!message.isRead ? "font-semibold text-foreground/90" : "font-normal text-foreground/70"}`}>{message.subject}</p>
                                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{message.accountDisplayName} &middot; {folderLabel(message.mailboxPath)}</p>
                                  </div>
                                )}
                              </div>
                            </button>
                          </div>
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
  };

  const renderMessageViewer = () => (
    <ScrollArea className="min-h-0 flex-1">
      {selectedMessage ? (
        <div className="flex h-full flex-col py-9">
          <div className="mx-auto w-full max-w-3xl px-8">
            <div className="flex items-start gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-violet-100 text-sm font-semibold text-violet-700">
                {selectedMessage.sender[0]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-3">
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight">{selectedMessage.subject}</h2>
                    <p className="mt-2 text-sm font-medium">{selectedMessage.sender}</p>
                    <p className="text-sm text-muted-foreground">{selectedMessage.accountDisplayName} · {folderLabel(selectedMessage.mailboxPath)}</p>
                  </div>
                  <time className="ml-auto shrink-0 text-xs text-muted-foreground">{selectedMessage.date}</time>
                </div>
                {messageBody?.html ? (
                  <div className="mt-8 flex gap-2">
                    <Button onClick={() => setContentMode("text")} size="sm" type="button" variant={contentMode === "text" ? "secondary" : "ghost"}>Text</Button>
                    <Button onClick={() => setContentMode("html")} size="sm" type="button" variant={contentMode === "html" ? "secondary" : "ghost"}>HTML</Button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {contentMode === "html" && messageBody?.html ? (
            <div className="mt-5 px-4">
              <iframe
                className="w-full rounded-lg border"
                ref={htmlFrameRef}
                referrerPolicy="no-referrer"
                sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                srcDoc={wrapEmailHtml(messageBody.html)}
                // content-box: frame.style.height below is set to match the inner
                // document's scrollHeight exactly. Under the app's default border-box
                // sizing, the 1px border would eat into that budget, leaving the inner
                // document ~2px too tall for its own iframe - a persistent few-pixel
                // inner scrollbar that isn't fixed by re-measuring (it's not a timing
                // issue, the shortfall is deterministic).
                style={{ minHeight: 200, boxSizing: "content-box" }}
                title="HTML message version"
              />
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl px-8">
              <div className="mail-body mt-8 whitespace-pre-wrap break-words text-[0.95rem] leading-7 text-foreground/85">
                {isBodyLoading ? "Loading message body…" : bodyError ?? messageBody?.text ?? "Message body is unavailable."}
              </div>
            </div>
          )}

          {messageBody?.attachments.length ? (
            <div className="mx-auto w-full max-w-3xl px-8">
              <div className="mt-8 space-y-3">
                <div className="flex flex-wrap gap-2">
                {messageBody.attachments.map((attachment) => (
                  <Button
                    className="attachment-chip"
                    disabled={savingAttachmentPosition !== null}
                    key={`${attachment.position}-${attachment.name}`}
                    onClick={() => void downloadAttachment(attachment.position, attachment.name)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Paperclip className="size-3.5" />
                    {savingAttachmentPosition === attachment.position ? "Saving…" : `${attachment.name} · ${attachment.mimeType}`}
                  </Button>
                ))}
                </div>
                {attachmentMessage ? <p className="text-sm text-muted-foreground" role="status">{attachmentMessage}</p> : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid h-full place-items-center p-8 text-center text-sm text-muted-foreground">
          Select a message to view it.
        </div>
      )}
    </ScrollArea>
  );

  const renderListHeader = (toggleModeButton: ReactNode) => (
    <header className="border-b px-5 py-4">
      <div className="flex items-center justify-between">
        <div>
          {activeAccountId !== null && (<p className="text-xs font-medium text-muted-foreground">{accountList.find((account) => account.id === activeAccountId)?.displayName}</p>)}
          <h1 className="mt-0.5 text-lg font-semibold">{activeAccountId === null ? "All inboxes" : folderLabel(activeFolder)}</h1>
        </div>
        <div className="flex gap-1">
          <IconButton label="Mark all as read" onClick={handleMarkAllRead}>
            <CheckCheck />
          </IconButton>
          {toggleModeButton}
        </div>
      </div>
      <label className="search-field mt-4">
        <Search className="size-4" />
        <span className="sr-only">Search messages</span>
        <input
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
          type="search"
          value={query}
        />
      </label>
    </header>
  );

  return (
    <TooltipProvider delayDuration={350}>
      <main className="h-svh overflow-hidden flex flex-col bg-background text-foreground">
        <div className="flex-1 overflow-hidden">
          <ResizablePanelGroup className="min-h-svh" orientation="horizontal">
            <ResizablePanel defaultSize="19%" minSize="16%">
              <aside className="flex h-full min-w-52 flex-col border-r bg-sidebar px-3 py-4">
                <div className="flex items-center justify-between px-2">
                  <div className="flex items-center gap-2 p-1 text-sm font-semibold">
                    <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
                      R
                    </span>
                    RMail
                  </div>
                  <div className="flex gap-1">
                    <IconButton label="Settings" onClick={() => setActiveView("settings")}>
                      <Settings />
                    </IconButton>
                    <IconButton label="Add account" onClick={() => setAddingAccount(true)}>
                      <Plus />
                    </IconButton>
                  </div>
                </div>

                <Button className="mt-6 w-full justify-start" onClick={openCompose}>
                  <PenLine />
                  Compose
                </Button>

                <Button className="mt-2 w-full" disabled={isSyncing} onClick={() => void syncAllAccounts()} size="sm" variant="secondary">
                  {isSyncing ? "Synchronizing…" : "Synchronize all"}
                </Button>

                <nav aria-label="Mail folders" className="mt-6 space-y-1">
                  <button
                    aria-current={activeAccountId === null ? "page" : undefined}
                    className="folder-link"
                    data-active={activeAccountId === null}
                    onClick={() => setActiveAccountId(null)}
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
                          onClick={() => {
                            if (isExpanded) {
                              setActiveAccountId(null);
                            } else {
                              setActiveAccountId(account.id);
                              setActiveFolder("INBOX");
                            }
                          }}
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
                                onClick={() => setActiveFolder(mailbox.path)}
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
            </ResizablePanel>

            <ResizableHandle />

            {layoutMode === "compact" ? (
              <ResizablePanel defaultSize="81%" minSize="40%">
                <section className="flex h-full min-w-72 flex-col">
                  {selectedMessage ? (
                    <article className="flex h-full flex-col">
                      <header className="flex items-center justify-between border-b px-5 py-3">
                        <IconButton label="Back" onClick={() => setSelectedMessageKey(null)}>
                          <ArrowLeft />
                        </IconButton>
                        <div className="flex gap-1">
                          <IconButton label="Archive"><Archive /></IconButton>
                          <IconButton label="Delete" onClick={() => handleDeleteMessage(selectedMessage)}><Trash2 /></IconButton>
                          <IconButton label="Snooze"><Clock3 /></IconButton>
                        </div>
                      </header>
                      {renderMessageViewer()}
                    </article>
                  ) : (
                    <>
                      {renderListHeader(
                        <IconButton label="Default mode" onClick={() => setLayoutMode("default")}>
                          <LayoutTemplate />
                        </IconButton>,
                      )}
                      {renderMessageList()}
                    </>
                  )}
                </section>
              </ResizablePanel>
            ) : (
              <>
                <ResizablePanel defaultSize="34%" minSize="26%">
                  <section className="flex h-full min-w-72 flex-col border-r">
                    {renderListHeader(
                      <IconButton label="Compact mode" onClick={() => setLayoutMode("compact")}>
                        <List />
                      </IconButton>,
                    )}
                    {renderMessageList()}
                  </section>
                </ResizablePanel>

                <ResizableHandle />

                <ResizablePanel defaultSize="47%" minSize="32%">
                  <article className="flex h-full min-w-80 flex-col">
                    <header className="flex items-center justify-between border-b px-6 py-4">
                      <div className="flex gap-1">
                        <IconButton label="Archive"><Archive /></IconButton>
                        <IconButton label="Delete" onClick={selectedMessage ? () => handleDeleteMessage(selectedMessage) : undefined}><Trash2 /></IconButton>
                        <IconButton label="Snooze"><Clock3 /></IconButton>
                      </div>
                    </header>

                    {renderMessageViewer()}
                  </article>
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </div>

        {isComposeOpen ? (
          <form aria-label="New message" className="compose-window" onSubmit={handleSendMessage}>
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-medium">New message</span>
              <Button onClick={() => setComposeOpen(false)} size="icon-xs" type="button" variant="ghost">×</Button>
            </div>
            <label className="compose-field">
              <span>From</span>
              <select onChange={(event) => setComposeAccountId(Number(event.target.value))} value={composeAccountId ?? ""}>
                {accountList.map((account) => <option key={account.id} value={account.id}>{account.displayName} · {account.email}</option>)}
              </select>
            </label>
            <label className="compose-field"><span>To</span><input autoFocus onChange={(event) => setCompose((current) => ({ ...current, recipients: event.target.value }))} placeholder="name@company.com, colleague@company.com" value={compose.recipients} /></label>
            <label className="compose-field"><span>Subject</span><input onChange={(event) => setCompose((current) => ({ ...current, subject: event.target.value }))} placeholder="Subject" value={compose.subject} /></label>
            <textarea aria-label="Message body" className="min-h-36 flex-1 resize-none p-4 outline-none" onChange={(event) => setCompose((current) => ({ ...current, body: event.target.value }))} placeholder="Write a message…" value={compose.body} />
            {composeMessage ? <p className="px-4 text-sm text-muted-foreground" role="status">{composeMessage}</p> : null}
            <div className="flex items-center justify-between border-t p-3">
              <div className="flex gap-2">
                <Button disabled={isSending} type="submit">{isSending ? "Sending…" : "Send"}</Button>
                <Button disabled={isSavingDraft || isSending} onClick={() => void handleSaveDraft()} type="button" variant="secondary">{isSavingDraft ? "Saving…" : "Save draft"}</Button>
              </div>
              <span className="text-xs text-muted-foreground">No attachments</span>
            </div>
          </form>
        ) : null}

        <footer className="flex h-7 shrink-0 items-center border-t bg-muted/50 px-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <span className={`size-2 rounded-full ${syncMessage.startsWith("Sync failed") ? "bg-red-500" : "bg-emerald-500"}`} />
            {syncMessage.startsWith("Synchronized") ? "Synchronization complete" : syncMessage.startsWith("Sync failed") ? "Synchronization failed" : "Synchronization pending"}
            {syncMessage !== "Synchronization pending" ? ` - ${syncMessage}` : null}
          </div>
        </footer>
      </main>
    </TooltipProvider>
  );
}

export default App;
