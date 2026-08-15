import sys

with open('src/App.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Remove AccountSetup component from App.tsx since it's extracted
code = code.replace('import { SettingsPage } from "@/components/SettingsPage";', 'import { AccountSetup } from "@/components/AccountSetup";\nimport { SettingsPage } from "@/components/SettingsPage";')

# Delete the inline AccountSetup component
start_idx = code.find('function AccountSetup({')
end_idx = code.find('function App() {')
if start_idx != -1 and end_idx != -1:
    code = code[:start_idx] + code[end_idx:]

# 2. Fix the onAccountCreated callback signature where AccountSetup is used
code = code.replace('onAccountCreated={async (account, password, newVaultPassword) => {\n          setVaultPassword(newVaultPassword);', 'onAccountCreated={async (account, password) => {')

# 3. Remove all vaultPassword, unlockPassword state
code = code.replace('  const [vaultPassword, setVaultPassword] = useState("");\n  const [unlockPassword, setUnlockPassword] = useState("");\n  const [unlockError, setUnlockError] = useState<string | null>(null);\n', '')
code = code.replace('  const [syncMessage, setSyncMessage] = useState("Unlock the vault to synchronize email");', '  const [syncMessage, setSyncMessage] = useState("Synchronization pending");')

# 4. Remove loadStoredVaultPassword and saveStoredVaultPassword imports
code = code.replace(',\n  loadStoredVaultPassword', '')
code = code.replace(',\n  saveStoredVaultPassword', '')

# 5. Fix accountCredential function
old_ac = '''  async function accountCredential(account: Account, name: "imapPassword" | "smtpPassword") {
    if (account.authType === "gmail_oauth") {
      return "";
    }
    if (!vaultPassword) {
      throw new Error("Unlock the vault to continue.");
    }
    const password = await readCredential(account.id, name, vaultPassword);
    if (!password) {
      throw new Error("Credentials were not found in the vault.");
    }
    return password;
  }'''
new_ac = '''  async function accountCredential(account: Account, name: "imapPassword" | "smtpPassword") {
    if (account.authType === "gmail_oauth") {
      return "";
    }
    const password = await readCredential(account.id, name);
    if (!password) {
      throw new Error("Credentials were not found.");
    }
    return password;
  }'''
code = code.replace(old_ac, new_ac)

# 6. Remove vault password from useEffect dependencies
code = code.replace(', [vaultPassword, accounts]);', ', [accounts]);')
code = code.replace(', [accounts, selectedMessageKey, vaultPassword]);', ', [accounts, selectedMessageKey]);')
code = code.replace(', [accounts, backgroundSettings, vaultPassword]);', ', [accounts, backgroundSettings]);')

# 7. Remove useEffect for loadStoredVaultPassword
vault_load_effect = '''  useEffect(() => {
    void loadStoredVaultPassword()
      .then((password) => {
        if (password) {
          setVaultPassword(password);
        }
      })
      .catch(() => undefined);
  }, []);\n\n'''
code = code.replace(vault_load_effect, '')

# 8. Remove `(!vaultPassword && ...)` logic
code = code.replace(' || (account.authType !== "gmail_oauth" && !vaultPassword)', '')
code = code.replace('\n      || (!vaultPassword && accounts.every((account) => account.authType === "password"))', '')

# 9. Remove unlockVault function
start_unlock = code.find('async function unlockVault(event: FormEvent<HTMLFormElement>) {')
end_unlock = code.find('async function downloadAttachment(position: number, name: string) {')
if start_unlock != -1 and end_unlock != -1:
    code = code[:start_unlock] + code[end_unlock:]

# 10. Remove unlock form from sidebar
sidebar_form = '''              {!vaultPassword && accountList.some((account) => account.authType === "password") ? (
                <form className="mt-3 space-y-2 rounded-lg border bg-background/70 p-3" onSubmit={unlockVault}>
                  <p className="text-xs leading-5 text-muted-foreground">Unlock the vault once to save its key in the operating system credential store.</p>
                  <label className="setup-field">
                    <span className="sr-only">Vault password</span>
                    <input onChange={(event) => setUnlockPassword(event.target.value)} placeholder="Vault password" required type="password" value={unlockPassword} />
                  </label>
                  {unlockError ? <p className="text-xs text-destructive" role="alert">{unlockError}</p> : null}
                  <Button className="w-full" size="sm" type="submit">Unlock vault</Button>
                </form>
              ) : null}\n\n'''
code = code.replace(sidebar_form, '')

# 11. Remove unlock form from message view
msg_form_start = code.find('{!vaultPassword && accountList.find((account) => account.id === selectedMessage.accountId)?.authType === "password" ? (')
msg_form_end = code.find(') : (\n                        <>\n                          {messageBody?.html ? (')
if msg_form_start != -1 and msg_form_end != -1:
    fragment_end = code.find('</>\n                      )}\n                    </div>', msg_form_end)
    if fragment_end != -1:
        inner = code[msg_form_end + len(') : (\n                        <>\n'):fragment_end]
        code = code[:msg_form_start] + '<>\n' + inner + code[fragment_end:]

# 12. Remove vaultPassword prop from SettingsPage
code = code.replace('        vaultPassword={vaultPassword}\n', '')

with open('src/App.tsx', 'w', encoding='utf-8') as f:
    f.write(code)
