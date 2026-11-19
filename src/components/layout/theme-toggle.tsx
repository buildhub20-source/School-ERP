"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/components/ui/cn";

/** Light / dark switch. Stored in the "theme" cookie (read by the root layout) and applied at once. */
export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(true);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const set = (toDark: boolean) => {
    document.documentElement.classList.toggle("dark", toDark);
    document.cookie = `theme=${toDark ? "dark" : "light"}; path=/; max-age=31536000; samesite=lax`;
    setDark(toDark);
  };
  const item = "grid size-7 place-items-center rounded-full transition-colors duration-150";
  return (
    <div role="radiogroup" aria-label="Theme" className={cn("flex items-center gap-0.5 rounded-full border border-line bg-surface-2 p-0.5", className)}>
      <button type="button" role="radio" aria-checked={!dark} aria-label="Light theme" onClick={() => set(false)}
        className={cn(item, !dark ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}><Sun className="size-3.5" /></button>
      <button type="button" role="radio" aria-checked={dark} aria-label="Dark theme" onClick={() => set(true)}
        className={cn(item, dark ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}><Moon className="size-3.5" /></button>
    </div>
  );
}
