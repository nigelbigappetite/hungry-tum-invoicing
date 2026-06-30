'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 dark:text-neutral-400 transition-colors hover:bg-gray-100 dark:hover:bg-neutral-800 hover:text-gray-900 dark:hover:text-neutral-100"
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
      <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
    </button>
  );
}
