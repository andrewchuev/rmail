import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Archive, ArrowLeft, Clock3, LayoutTemplate, List, Trash2 } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { info as logInfo, warn as logWarn } from "@tauri-apps/plugin-log";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { AccountSetup } from "@/components/AccountSetup";
import { SettingsPage } from "@/components/SettingsPage";
import { ComposeWindow, emptyCompose, type ComposeState } from "@/components/mail/ComposeWindow";
import { IconButton } from "@/components/mail/IconButton";
import { MessageList, MessageListHeader } from "@/components/mail/MessageList";
import { MessageViewer } from "@/components/mail/MessageViewer";
import { Sidebar } from "@/components/mail/Sidebar";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  addNotificationExclusion,
  deleteDraft,
  deleteMessages,
  listAccounts,
  listCachedMailboxes,
  listCachedMessages,
  listNotificationExclusions,
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
  type NotificationExclusion,
} from "@/lib/accounts";
import { applyWindowSettings, loadBackgroundSettings, saveBackgroundSettings, type BackgroundSettings } from "@/lib/settings";
import "./App.css";
import { folderLabel, attachmentFileName, messageKey, cachedMessagesEqual, cachedMailboxesEqual } from "@/lib/utils";

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
  const [notificationExclusions, setNotificationExclusions] = useState<NotificationExclusion[]>([]);
  const excludedSenderEmails = useMemo(
    () => new Set(notificationExclusions.map((exclusion) => exclusion.sender.toLowerCase())),
    [notificationExclusions],
  );
  useEffect(() => {
    const notifiableAccountIds = new Set((accounts ?? []).filter((a) => a.notificationsEnabled).map((a) => a.id));
    listUnifiedInbox().then((inbox) => {
      // If we just clicked a message, cachedMessages might have local optimistic updates not in DB yet
      // So let's count optimistic unread statuses as well!
      let unreadCount = 0;
      for (const msg of inbox) {
        if (!notifiableAccountIds.has(msg.accountId)) continue;
        if (excludedSenderEmails.has(msg.senderEmail.toLowerCase())) continue;
        const cached = cachedMessages.find(m => m.uid === msg.uid && m.accountId === msg.accountId);
        if (cached) {
            if (!cached.isRead) unreadCount++;
        } else {
            if (!msg.isRead) unreadCount++;
        }
      }
      void logInfo(`tray unread check: notifiableAccounts=${notifiableAccountIds.size} excludedSenders=${excludedSenderEmails.size} unreadCount=${unreadCount}`);
      setTrayUnreadState(unreadCount > 0).catch(console.error);
    }).catch(console.error);
  }, [syncRevision, cachedMessages, accounts, excludedSenderEmails]);
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

  function handleToggleSelectAll(checked: boolean) {
    setSelectedMessageKeys(checked ? new Set(visibleMessages.map(messageKey)) : new Set());
  }

  function handleSelectMessagesFromSender(message: CachedMessage) {
    const senderKey = (message.senderEmail || message.sender).toLowerCase();
    setSelectedMessageKeys((current) => {
      const next = new Set(current);
      for (const candidate of visibleMessages) {
        if ((candidate.senderEmail || candidate.sender).toLowerCase() === senderKey) {
          next.add(messageKey(candidate));
        }
      }
      return next;
    });
  }

  function handleToggleAccount(accountId: number, isExpanded: boolean) {
    if (isExpanded) {
      setActiveAccountId(null);
    } else {
      setActiveAccountId(accountId);
      setActiveFolder("INBOX");
    }
  }

  function handleSelectMessage(message: CachedMessage) {
    const key = messageKey(message);
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
    let ignore = false;

    void listNotificationExclusions()
      .then((items) => {
        if (!ignore) {
          setNotificationExclusions(items);
        }
      })
      .catch(console.error);

    return () => {
      ignore = true;
    };
  }, []);

  async function refreshNotificationExclusions() {
    setNotificationExclusions(await listNotificationExclusions());
  }

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
    return <main className="grid min-h-svh place-items-center p-6 text-sm text-destructive-text">{loadError}</main>;
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

  function handleReplyToMessage(message: CachedMessage) {
    setCompose({
      recipients: message.senderEmail || message.sender,
      subject: /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`,
      body: "",
    });
    setDraftId(null);
    setComposeMessage(null);
    setComposeAccountId(message.accountId);
    setComposeOpen(true);
  }

  async function handleExcludeSenderFromNotifications(message: CachedMessage) {
    const sender = message.senderEmail || message.sender;
    try {
      await addNotificationExclusion(sender);
      await refreshNotificationExclusions();
    } catch (reason) {
      console.error("Unable to exclude the sender from notifications:", reason);
    }
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
        (message) => !knownMessageKeys.current.has(messageKey(message))
          && notifiableAccountIds.has(message.accountId)
          && !excludedSenderEmails.has(message.senderEmail.toLowerCase()),
      ).length;
      knownMessageKeys.current = currentKeys;
      void logInfo(
        `notification check: background=${isBackground} hasCompletedBackgroundSync=${hasCompletedBackgroundSync.current} notificationsEnabled=${backgroundSettings.notifications} newNotifiableCount=${newNotifiableCount}`,
      );
      if (isBackground && hasCompletedBackgroundSync.current && successful.length && backgroundSettings.notifications && newNotifiableCount) {
        const granted = await isPermissionGranted() || await requestPermission() === "granted";
        void logInfo(`notification permission granted=${granted}`);
        if (granted) {
          sendNotification({ title: "RMail", body: `New messages: ${newNotifiableCount}.` });
          void logInfo(`notification sent: count=${newNotifiableCount}`);
        }
      }
      hasCompletedBackgroundSync.current = true;
      const errors = results.map((result, i) => result.status === "rejected" ? `${accountList[i].displayName}: ${result.reason instanceof Error ? result.reason.message : String(result.reason || "Unknown error")}` : null).filter(Boolean);
      startTransition(() => setSyncMessage(
        errors.length === 0
          ? `Synchronized all ${successful.length} accounts, messages: ${messageCount}`
          : `Sync failed for ${errors.join("; ")}`
      ));
    } catch (reason) {
      if (!isBackground) setSyncMessage("Unable to update the local email cache");
      void logWarn(`syncAllAccounts failed: background=${isBackground} reason=${reason instanceof Error ? reason.message : String(reason)}`);
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
        notificationExclusions={notificationExclusions}
        onAccountUpdated={(updated) => setAccounts((current) => current?.map((account) => account.id === updated.id ? updated : account) ?? [])}
        onAddAccount={() => setAddingAccount(true)}
        onBack={() => setActiveView("mail")}
        onBackgroundSettingsChange={setBackgroundSettings}
        onCacheFlushed={handleCacheFlushed}
        onNotificationExclusionsChanged={refreshNotificationExclusions}
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

  const listPaneTitle = activeAccountId === null ? "All inboxes" : folderLabel(activeFolder);
  const listPaneAccountName = activeAccountId !== null
    ? accountList.find((account) => account.id === activeAccountId)?.displayName
    : undefined;

  const renderMessageListPane = (toggleModeButton: ReactNode) => (
    <>
      <MessageListHeader
        accountName={listPaneAccountName}
        onMarkAllRead={handleMarkAllRead}
        onQueryChange={setQuery}
        query={query}
        title={listPaneTitle}
        toggleModeButton={toggleModeButton}
      />
      <MessageList
        excludedSenderEmails={excludedSenderEmails}
        layoutMode={layoutMode}
        messages={visibleMessages}
        onBulkDelete={handleBulkDelete}
        onBulkMarkRead={handleBulkMarkRead}
        onClearSelection={() => setSelectedMessageKeys(new Set())}
        onDeleteMessage={handleDeleteMessage}
        onExcludeSender={(message) => void handleExcludeSenderFromNotifications(message)}
        onReply={handleReplyToMessage}
        onSelectFromSender={handleSelectMessagesFromSender}
        onSelectMessage={handleSelectMessage}
        onToggleMessageSelection={toggleMessageSelection}
        onToggleSelectAll={handleToggleSelectAll}
        query={query}
        selectedMessageKey={selectedMessageKey}
        selectedMessageKeys={selectedMessageKeys}
      />
    </>
  );

  const renderMessageViewerPane = () => (
    <MessageViewer
      attachmentMessage={attachmentMessage}
      bodyError={bodyError}
      contentMode={contentMode}
      isBodyLoading={isBodyLoading}
      message={selectedMessage}
      messageBody={messageBody}
      onContentModeChange={setContentMode}
      onDownloadAttachment={(position, name) => void downloadAttachment(position, name)}
      savingAttachmentPosition={savingAttachmentPosition}
    />
  );

  return (
    <TooltipProvider delayDuration={350}>
      <main className="h-svh overflow-hidden flex flex-col bg-background text-foreground">
        <div className="flex-1 overflow-hidden">
          <ResizablePanelGroup className="min-h-svh" orientation="horizontal">
            <ResizablePanel defaultSize="19%" minSize="16%">
              <Sidebar
                accountList={accountList}
                activeAccountId={activeAccountId}
                activeFolder={activeFolder}
                isSyncing={isSyncing}
                mailboxes={mailboxes}
                onAddAccount={() => setAddingAccount(true)}
                onCompose={openCompose}
                onOpenSettings={() => setActiveView("settings")}
                onSelectAllInboxes={() => setActiveAccountId(null)}
                onSelectFolder={setActiveFolder}
                onSyncAll={() => void syncAllAccounts()}
                onToggleAccount={handleToggleAccount}
              />
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
                      {renderMessageViewerPane()}
                    </article>
                  ) : (
                    renderMessageListPane(
                      <IconButton label="Default mode" onClick={() => setLayoutMode("default")}>
                        <LayoutTemplate />
                      </IconButton>,
                    )
                  )}
                </section>
              </ResizablePanel>
            ) : (
              <>
                <ResizablePanel defaultSize="34%" minSize="26%">
                  <section className="flex h-full min-w-72 flex-col border-r">
                    {renderMessageListPane(
                      <IconButton label="Compact mode" onClick={() => { setLayoutMode("compact"); setSelectedMessageKey(null); }}>
                        <List />
                      </IconButton>,
                    )}
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

                    {renderMessageViewerPane()}
                  </article>
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </div>

        {isComposeOpen ? (
          <ComposeWindow
            accountList={accountList}
            compose={compose}
            composeAccountId={composeAccountId}
            composeMessage={composeMessage}
            isSavingDraft={isSavingDraft}
            isSending={isSending}
            onClose={() => setComposeOpen(false)}
            onComposeAccountChange={setComposeAccountId}
            onComposeChange={(patch) => setCompose((current) => ({ ...current, ...patch }))}
            onSaveDraft={() => void handleSaveDraft()}
            onSubmit={handleSendMessage}
          />
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
