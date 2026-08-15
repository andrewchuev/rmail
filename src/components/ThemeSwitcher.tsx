import { Palette, Moon, Sun, Monitor } from "lucide-react";
import { useTheme, type Preset } from "./ThemeProvider";

const presets: { name: string; value: Preset; colorClass: string }[] = [
  { name: "Zinc", value: "zinc", colorClass: "bg-zinc-500" },
  { name: "Rose", value: "rose", colorClass: "bg-rose-500" },
  { name: "Blue", value: "blue", colorClass: "bg-blue-500" },
  { name: "Green", value: "green", colorClass: "bg-green-500" },
  { name: "Orange", value: "orange", colorClass: "bg-orange-500" },
];

export function ThemeSwitcher() {
  const { theme, setTheme, preset, setPreset } = useTheme();

  return (
    <div className="flex flex-col gap-6 p-5">
      <div className="flex items-center gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Palette className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Color Theme</span>
          <span className="mt-1 block text-sm text-muted-foreground">
            Select your preferred color preset.
          </span>
        </span>
        <div className="flex gap-2">
          {presets.map((p) => (
            <button
              key={p.value}
              type="button"
              aria-label={`Select ${p.name} theme`}
              className={`size-6 rounded-full border-2 ${
                preset === p.value ? "border-primary" : "border-transparent"
              } ${p.colorClass}`}
              onClick={() => setPreset(p.value)}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Moon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Appearance</span>
          <span className="mt-1 block text-sm text-muted-foreground">
            Toggle between light and dark mode.
          </span>
        </span>
        <div className="flex rounded-md border bg-background p-1">
          <button
            type="button"
            className={`flex items-center gap-2 rounded-sm px-3 py-1.5 text-xs font-medium ${
              theme === "light" ? "bg-accent text-accent-foreground shadow-sm" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            }`}
            onClick={() => setTheme("light")}
          >
            <Sun className="size-3.5" />
            Light
          </button>
          <button
            type="button"
            className={`flex items-center gap-2 rounded-sm px-3 py-1.5 text-xs font-medium ${
              theme === "dark" ? "bg-accent text-accent-foreground shadow-sm" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            }`}
            onClick={() => setTheme("dark")}
          >
            <Moon className="size-3.5" />
            Dark
          </button>
          <button
            type="button"
            className={`flex items-center gap-2 rounded-sm px-3 py-1.5 text-xs font-medium ${
              theme === "system" ? "bg-accent text-accent-foreground shadow-sm" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            }`}
            onClick={() => setTheme("system")}
          >
            <Monitor className="size-3.5" />
            System
          </button>
        </div>
      </div>
    </div>
  );
}
