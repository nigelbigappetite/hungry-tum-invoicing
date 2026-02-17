'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  LogOut,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import ThemeToggle from '@/components/ThemeToggle';
import { LOGOS } from '@/lib/logos';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/franchisees', label: 'Franchisees', icon: Users },
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
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col bg-sidebar-bg text-sidebar-text">
      {/* Logo / Brand */}
      <div className="flex h-16 items-center gap-3 border-b border-white/10 dark:border-neutral-800 px-6">
        <img
          src={LOGOS.app}
          alt="Hungry Tum"
          className="h-9 w-9 object-contain object-center"
        />
        <div>
          <h1 className="text-base font-bold text-white dark:text-neutral-100">Hungry Tum</h1>
          <p className="text-xs text-slate-400 dark:text-neutral-500">Invoicing</p>
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
                  : 'text-slate-300 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 hover:bg-white/10 hover:text-white'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Theme + Sign out */}
      <div className="border-t border-white/10 dark:border-neutral-800 p-3 space-y-1">
        <ThemeToggle />
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 dark:text-neutral-400 transition-colors dark:hover:bg-neutral-800 dark:hover:text-neutral-100 hover:bg-white/10 hover:text-white"
        >
          <LogOut className="h-5 w-5" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
