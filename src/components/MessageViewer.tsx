import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Paperclip } from "lucide-react";
import { type CachedMessage, type MessageBody } from "@/lib/accounts";
import { folderLabel } from "@/lib/mail-utils";

export interface MessageViewerProps {
  selectedMessage: CachedMessage | null;
  messageBody: MessageBody | null;
  isBodyLoading: boolean;
  bodyError: string | null;
  contentMode: "text" | "html";
  setContentMode: (mode: "text" | "html") => void;
  savingAttachmentPosition: number | null;
  attachmentMessage: string | null;
  onDownloadAttachment: (position: number, name: string) => void;
}

export function MessageViewer({
  selectedMessage,
  messageBody,
  isBodyLoading,
  bodyError,
  contentMode,
  setContentMode,
  savingAttachmentPosition,
  attachmentMessage,
  onDownloadAttachment,
}: MessageViewerProps) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      {selectedMessage ? (
        <div className="mx-auto max-w-3xl px-8 py-9">
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

              <>
                {messageBody?.html ? (
                  <div className="mt-8 flex gap-2">
                    <Button onClick={() => setContentMode("text")} size="sm" type="button" variant={contentMode === "text" ? "secondary" : "ghost"}>Text</Button>
                    <Button onClick={() => setContentMode("html")} size="sm" type="button" variant={contentMode === "html" ? "secondary" : "ghost"}>HTML</Button>
                  </div>
                ) : null}
                {contentMode === "html" && messageBody?.html ? (
                  <iframe
                    className="mt-5 min-h-96 w-full rounded-lg border bg-background"
                    referrerPolicy="no-referrer"
                    sandbox=""
                    srcDoc={messageBody.html}
                    title="HTML message version"
                  />
                ) : (
                  <div className="mail-body mt-8 whitespace-pre-wrap break-words text-[0.95rem] leading-7 text-foreground/85">
                    {isBodyLoading ? "Loading message body…" : bodyError ?? messageBody?.text ?? "Message body is unavailable."}
                  </div>
                )}
                {messageBody?.attachments.length ? (
                  <div className="mt-8 space-y-3">
                    <div className="flex flex-wrap gap-2">
                    {messageBody.attachments.map((attachment) => (
                      <Button
                        className="attachment-chip"
                        disabled={savingAttachmentPosition !== null}
                        key={`${attachment.position}-${attachment.name}`}
                        onClick={() => void onDownloadAttachment(attachment.position, attachment.name)}
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
                ) : null}
              </>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid h-full place-items-center p-8 text-center text-sm text-muted-foreground">
          Select a message to view it.
        </div>
      )}
    </ScrollArea>
  );
}
