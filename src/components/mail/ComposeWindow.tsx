import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import type { Account } from "@/lib/accounts";

export type ComposeState = {
  recipients: string;
  subject: string;
  body: string;
};

export const emptyCompose: ComposeState = { recipients: "", subject: "", body: "" };

export function ComposeWindow({
  accountList,
  compose,
  composeAccountId,
  composeMessage,
  isSavingDraft,
  isSending,
  onClose,
  onComposeAccountChange,
  onComposeChange,
  onSaveDraft,
  onSubmit,
}: {
  accountList: Account[];
  compose: ComposeState;
  composeAccountId: number | null;
  composeMessage: string | null;
  isSavingDraft: boolean;
  isSending: boolean;
  onClose: () => void;
  onComposeAccountChange: (accountId: number) => void;
  onComposeChange: (patch: Partial<ComposeState>) => void;
  onSaveDraft: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form aria-label="New message" className="compose-window" onSubmit={onSubmit}>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="text-sm font-medium">New message</span>
        <Button onClick={onClose} size="icon-xs" type="button" variant="ghost">×</Button>
      </div>
      <label className="compose-field">
        <span>From</span>
        <select onChange={(event) => onComposeAccountChange(Number(event.target.value))} value={composeAccountId ?? ""}>
          {accountList.map((account) => <option key={account.id} value={account.id}>{account.displayName} · {account.email}</option>)}
        </select>
      </label>
      <label className="compose-field"><span>To</span><input autoFocus onChange={(event) => onComposeChange({ recipients: event.target.value })} placeholder="name@company.com, colleague@company.com" value={compose.recipients} /></label>
      <label className="compose-field"><span>Subject</span><input onChange={(event) => onComposeChange({ subject: event.target.value })} placeholder="Subject" value={compose.subject} /></label>
      <textarea aria-label="Message body" className="min-h-36 flex-1 resize-none p-4 outline-none" onChange={(event) => onComposeChange({ body: event.target.value })} placeholder="Write a message…" value={compose.body} />
      {composeMessage ? <p className="px-4 text-sm text-muted-foreground" role="status">{composeMessage}</p> : null}
      <div className="flex items-center justify-between border-t p-3">
        <div className="flex gap-2">
          <Button disabled={isSending} type="submit">{isSending ? "Sending…" : "Send"}</Button>
          <Button disabled={isSavingDraft || isSending} onClick={onSaveDraft} type="button" variant="secondary">{isSavingDraft ? "Saving…" : "Save draft"}</Button>
        </div>
        <span className="text-xs text-muted-foreground">No attachments</span>
      </div>
    </form>
  );
}
