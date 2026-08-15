import sys

with open('src/App.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

tooltip_imports = '''import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
'''

code = code.replace('import {\n  deleteDraft,', tooltip_imports + 'import {\n  deleteDraft,')

with open('src/App.tsx', 'w', encoding='utf-8') as f:
    f.write(code)
