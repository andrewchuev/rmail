import re

with open('src/App.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# Add Select imports
select_imports = '''import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
'''
code = code.replace('import { ScrollArea }', select_imports + 'import { ScrollArea }')

# Add layout icons
lucide_imports = 'Archive, ArrowLeft, ChevronDown, Clock3, Inbox, LayoutTemplate, List, MoreHorizontal, Paperclip, PenLine, Plus, Search, Settings, Trash2'
code = re.sub(r'import {([^}]+)} from "lucide-react";', f'import {{ {lucide_imports} }} from "lucide-react";', code)

# Find the start of the return statement
return_start = code.find('  return (\n    <TooltipProvider delayDuration={350}>')

# Extract message list JSX
msg_list_start = code.find('<div className="p-2">', return_start)
msg_list_end = code.find('</ScrollArea>\n            </section>', msg_list_start)
msg_list_jsx = code[msg_list_start:msg_list_end].strip()

# Extract message viewer JSX
msg_viewer_start = code.find('{selectedMessage ? (', return_start)
msg_viewer_end = code.find('</ScrollArea>\n            </article>', msg_viewer_start)
msg_viewer_jsx = code[msg_viewer_start:msg_viewer_end].strip()

# Create the helper functions
helpers = f'''  const renderMessageList = () => (
    <ScrollArea className="min-h-0 flex-1">
      {msg_list_jsx}
    </ScrollArea>
  );

  const renderMessageViewer = () => (
    <ScrollArea className="min-h-0 flex-1">
      {msg_viewer_jsx}
    </ScrollArea>
  );

'''

default_header = '''                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">{activeAccountId === null ? "Unified inbox" : accountList.find((account) => account.id === activeAccountId)?.displayName}</p>
                    <h1 className="mt-0.5 text-lg font-semibold">{activeAccountId === null ? "All inboxes" : folderLabel(activeFolder)}</h1>
                  </div>
                  <div className="flex gap-1">
                    <IconButton label="Compact mode" onClick={() => { setLayoutMode("compact"); setActiveAccountId(null); }}>
                      <List />
                    </IconButton>
                    <IconButton label="More actions">
                      <MoreHorizontal />
                    </IconButton>
                  </div>
                </div>'''

code = code.replace('''                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">{activeAccountId === null ? "Unified inbox" : accountList.find((account) => account.id === activeAccountId)?.displayName}</p>
                    <h1 className="mt-0.5 text-lg font-semibold">{activeAccountId === null ? "All inboxes" : folderLabel(activeFolder)}</h1>
                  </div>
                  <IconButton label="More actions">
                    <MoreHorizontal />
                  </IconButton>
                </div>''', default_header)

code = code[:return_start] + helpers + code[return_start:]
code = code.replace(f'<ScrollArea className="min-h-0 flex-1">\n                {msg_list_jsx}\n              </ScrollArea>', '{renderMessageList()}')
code = code.replace(f'<ScrollArea className="min-h-0 flex-1">\n                {msg_viewer_jsx}\n              </ScrollArea>', '{renderMessageViewer()}')

compact_layout = '''
          {layoutMode === "compact" ? (
            <div className="flex h-full w-full flex-col">
              <header className="flex items-center justify-between border-b px-5 py-3 shadow-sm">
                <div className="flex items-center gap-3">
                  {selectedMessage ? (
                    <IconButton label="Back" onClick={() => setSelectedMessageKey(null)}>
                      <ArrowLeft />
                    </IconButton>
                  ) : null}
                  <Select
                    value={activeAccountId === null ? "all" : activeAccountId.toString()}
                    onValueChange={(val) => {
                      setActiveAccountId(val === "all" ? null : Number(val));
                      setActiveFolder("INBOX");
                      setSelectedMessageKey(null);
                    }}
                  >
                    <SelectTrigger className="w-[200px] border-none bg-transparent shadow-none focus:ring-0 text-base font-semibold">
                      <SelectValue placeholder="All inboxes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All inboxes</SelectItem>
                      {accountList.map((acc) => (
                        <SelectItem key={acc.id} value={acc.id.toString()}>{acc.displayName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  {!selectedMessage ? (
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                      <input
                        className="h-9 rounded-md border border-input bg-transparent px-3 py-1 pl-9 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search..."
                        type="search"
                        value={query}
                      />
                    </div>
                  ) : null}
                  <IconButton label="Default mode" onClick={() => setLayoutMode("default")}>
                    <LayoutTemplate />
                  </IconButton>
                </div>
              </header>
              <div className="flex-1 overflow-hidden">
                {selectedMessage ? (
                  <article className="flex h-full flex-col">
                    <header className="flex items-center justify-end border-b px-6 py-2">
                      <div className="flex gap-1">
                        <IconButton label="Archive"><Archive /></IconButton>
                        <IconButton label="Delete"><Trash2 /></IconButton>
                        <IconButton label="Snooze"><Clock3 /></IconButton>
                        <IconButton label="More"><MoreHorizontal /></IconButton>
                      </div>
                    </header>
                    {renderMessageViewer()}
                  </article>
                ) : (
                  <section className="flex h-full flex-col">
                    {renderMessageList()}
                  </section>
                )}
              </div>
            </div>
          ) : (
'''

panel_start = code.find('<ResizablePanelGroup')
code = code[:panel_start] + compact_layout + code[panel_start:]

panel_end = code.find('</ResizablePanelGroup>') + len('</ResizablePanelGroup>')
code = code[:panel_end] + '\n          )}' + code[panel_end:]

with open('src/App.tsx', 'w', encoding='utf-8') as f:
    f.write(code)
