import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  createAccount,
  connectGmail,
  diagnosticLogPath,
  deleteAccount,
  testMailConnection,
  type Account,
  type CreateAccountInput,
} from "@/lib/accounts";
import {
  deleteCredentials,
  saveCredentials,
  saveStoredVaultPassword,
} from "@/lib/credentials";
import { connectionErrorMessage } from "@/lib/errors";

export function AccountSetup({
  isAdditional = false,
  onAccountCreated,
  onCancel,
  onGmailConnected,
}: {
  isAdditional?: boolean;
  onAccountCreated: (account: Account, password: string, vaultPassword: string) => Promise<void>;
  onCancel?: () => void;
  onGmailConnected: (account: Account) => Promise<void>;
}) {
  const [input, setInput] = useState<CreateAccountInput>({
    displayName: "",
    email: "",
    imapHost: "",
    smtpHost: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [connectionPassword, setConnectionPassword] = useState("");
  const [vaultPassword, setVaultPassword] = useState("");
  const [vaultPasswordConfirmation, setVaultPasswordConfirmation] = useState("");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [diagnosticLog, setDiagnosticLog] = useState<string | null>(null);
  const [isTesting, setTesting] = useState(false);
  const [isConnectionVerified, setConnectionVerified] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);
  const [isGmailConnecting, setGmailConnecting] = useState(false);

  async function connectGoogleAccount() {
    setError(null);
    setGmailConnecting(true);
    try {
      await onGmailConnected(await connectGmail());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason || "Unable to connect Gmail."));
    } finally {
      setGmailConnecting(false);
    }
  }

  function updateField(field: keyof CreateAccountInput, value: string) {
    setInput((current) => ({ ...current, [field]: value }));
    setConnectionVerified(false);
    setConnectionMessage(null);
  }

  async function testConnection() {
    setError(null);
    setConnectionMessage(null);
    setDiagnosticLog(null);
    setConnectionVerified(false);
    setTesting(true);

    try {
      const status = await testMailConnection({
        imapHost: input.imapHost,
        imapPort: 993,
        smtpHost: input.smtpHost,
        smtpPort: 587,
        username: input.email,
        password: connectionPassword,
      });
      setConnectionVerified(true);
      setConnectionMessage(`Connection verified. Mailboxes found: ${status.mailboxes.length}.`);
    } catch (reason) {
      setError(connectionErrorMessage(reason));
      void diagnosticLogPath().then(setDiagnosticLog).catch(() => undefined);
    } finally {
      setTesting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!isConnectionVerified) {
      setError("Verify the connection first.");
      return;
    }

    if (vaultPassword.length < 12) {
      setError("The vault password must be at least 12 characters long.");
      return;
    }

    if (!isAdditional && vaultPassword !== vaultPasswordConfirmation) {
      setError("The vault passwords do not match.");
      return;
    }

    setSubmitting(true);

    try {
      const account = await createAccount(input);

      try {
        await saveCredentials(account.id, connectionPassword, vaultPassword);
        await saveStoredVaultPassword(vaultPassword).catch(() => undefined);
      } catch {
        await deleteCredentials(account.id, vaultPassword).catch(() => undefined);
        await deleteAccount(account.id).catch(() => undefined);
        throw new Error("Unable to save credentials. The account was not added.");
      }

      await onAccountCreated(account, connectionPassword, vaultPassword);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save the account.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-svh place-items-center bg-background px-6 py-6">
      <section className="w-full max-w-md rounded-2xl border bg-card p-7 shadow-sm" aria-labelledby="setup-title">
        <span className="grid size-10 place-items-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">R</span>
        <p className="mt-7 text-sm font-medium text-primary">{isAdditional ? "New account" : "First account"}</p>
        <h1 id="setup-title" className="mt-1 text-2xl font-semibold tracking-tight">Connect your email</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Verify IMAP and SMTP access, then protect your credentials with a vault password.
        </p>

        <Button className="mt-6 w-full" disabled={isGmailConnecting} onClick={() => void connectGoogleAccount()} type="button" variant="secondary">
          {isGmailConnecting ? "Waiting for Google…" : "Connect Gmail"}
        </Button>
        <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" /><span>or configure IMAP manually</span><span className="h-px flex-1 bg-border" /></div>

        <form className="space-y-4" onSubmit={submit}>
          <label className="setup-field">
            <span>Account name</span>
            <input onChange={(event) => updateField("displayName", event.target.value)} placeholder="Work email" required value={input.displayName} />
          </label>
          <label className="setup-field">
            <span>Email address</span>
            <input onChange={(event) => updateField("email", event.target.value)} placeholder="name@company.com" required type="email" value={input.email} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="setup-field">
              <span>IMAP server</span>
              <input onChange={(event) => updateField("imapHost", event.target.value)} placeholder="imap.company.com" required value={input.imapHost} />
            </label>
            <label className="setup-field">
              <span>SMTP server</span>
              <input onChange={(event) => updateField("smtpHost", event.target.value)} placeholder="smtp.company.com" required value={input.smtpHost} />
            </label>
          </div>
          <label className="setup-field">
            <span>Email password</span>
            <input
              onChange={(event) => {
                setConnectionPassword(event.target.value);
                setConnectionVerified(false);
                setConnectionMessage(null);
              }}
              required
              type="password"
              value={connectionPassword}
            />
            <small>IMAP: SSL/TLS, port 993 · SMTP: STARTTLS, port 587</small>
          </label>
          <Button className="w-full" disabled={isTesting} onClick={() => void testConnection()} type="button" variant="secondary">
            {isTesting ? "Verifying connection…" : "Verify connection"}
          </Button>
          {connectionMessage ? <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">{connectionMessage}</p> : null}
          <label className="setup-field">
            <span>{isAdditional ? "Current vault password" : "Vault password"}</span>
            <input
              onChange={(event) => setVaultPassword(event.target.value)}
              required
              type="password"
              value={vaultPassword}
            />
            <small>{isAdditional ? "Use the password that already protects your connected accounts." : "Use at least 12 characters. It will be stored in the operating system credential store."}</small>
          </label>
          {isAdditional ? null : <label className="setup-field">
            <span>Confirm vault password</span>
            <input
              onChange={(event) => setVaultPasswordConfirmation(event.target.value)}
              required
              type="password"
              value={vaultPasswordConfirmation}
            />
          </label>}
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          {diagnosticLog ? <p className="text-xs leading-5 text-muted-foreground">Diagnostic log: <code className="break-all">{diagnosticLog}</code></p> : null}
          <Button className="mt-2 w-full" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Saving…" : "Continue"}
          </Button>
          {onCancel ? <Button className="w-full" onClick={onCancel} type="button" variant="ghost">Cancel</Button> : null}
        </form>
      </section>
    </main>
  );
}
