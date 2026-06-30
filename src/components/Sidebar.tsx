'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  BarChart2,
  LogOut,
  CalendarDays,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import ThemeToggle from '@/components/ThemeToggle';
import { LOGOS } from '@/lib/logos';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/weekly', label: 'Weekly Hub', icon: CalendarDays },
  { href: '/franchisees', label: 'Franchisees', icon: Users },
  { href: '/analytics', label: 'Finance Analytics', icon: BarChart2 },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col bg-white dark:bg-neutral-900 border-r border-gray-200 dark:border-neutral-800">
      {/* Logo / Brand */}
      <div className="flex h-16 items-center gap-3 border-b border-gray-200 dark:border-neutral-800 px-6">
        <img
          src={LOGOS.app}
          alt="Hungry Tum"
          className="h-9 w-9 object-contain object-center"
        />
        <div>
          <h1 className="text-base font-bold text-gray-900 dark:text-neutral-100">Hungry Tum</h1>
          <p className="text-xs text-gray-500 dark:text-neutral-500">Invoicing</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-white'
                  : 'text-gray-600 dark:text-neutral-400 hover:bg-gray-100 dark:hover:bg-neutral-800 hover:text-gray-900 dark:hover:text-neutral-100'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Theme + Sign out */}
      <div className="border-t border-gray-200 dark:border-neutral-800 p-3 space-y-1">
        <ThemeToggle />
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 dark:text-neutral-400 transition-colors hover:bg-gray-100 dark:hover:bg-neutral-800 hover:text-gray-900 dark:hover:text-neutral-100"
        >
          <LogOut className="h-5 w-5" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
