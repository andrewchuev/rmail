import { useEffect, useRef } from "react";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CachedMessage, MessageBody } from "@/lib/accounts";
import { folderLabel, wrapEmailHtml } from "@/lib/utils";

export function MessageViewer({
  attachmentMessage,
  bodyError,
  contentMode,
  isBodyLoading,
  message,
  messageBody,
  onContentModeChange,
  onDownloadAttachment,
  savingAttachmentPosition,
}: {
  attachmentMessage: string | null;
  bodyError: string | null;
  contentMode: "text" | "html";
  isBodyLoading: boolean;
  message: CachedMessage | null;
  messageBody: MessageBody | null;
  onContentModeChange: (mode: "text" | "html") => void;
  onDownloadAttachment: (position: number, name: string) => void;
  savingAttachmentPosition: number | null;
}) {
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

  return (
    <ScrollArea className="min-h-0 flex-1">
      {message ? (
        <div className="flex h-full flex-col py-9">
          <div className="mx-auto w-full max-w-3xl px-8">
            <div className="flex items-start gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-violet-100 text-sm font-semibold text-violet-700">
                {message.sender[0]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-3">
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight">{message.subject}</h2>
                    <p className="mt-2 text-sm font-medium">{message.sender}</p>
                    <p className="text-sm text-muted-foreground">{message.accountDisplayName} · {folderLabel(message.mailboxPath)}</p>
                  </div>
                  <time className="ml-auto shrink-0 text-xs text-muted-foreground">{message.date}</time>
                </div>
                {messageBody?.html ? (
                  <div className="mt-8 flex gap-2">
                    <Button onClick={() => onContentModeChange("text")} size="sm" type="button" variant={contentMode === "text" ? "secondary" : "ghost"}>Text</Button>
                    <Button onClick={() => onContentModeChange("html")} size="sm" type="button" variant={contentMode === "html" ? "secondary" : "ghost"}>HTML</Button>
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
                    onClick={() => onDownloadAttachment(attachment.position, attachment.name)}
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
}
