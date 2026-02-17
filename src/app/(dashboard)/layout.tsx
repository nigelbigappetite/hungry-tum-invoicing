import Sidebar from '@/components/Sidebar';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-[#252525]">
      <Sidebar />
      <main className="ml-64 flex-1 p-8 bg-slate-50 dark:bg-[#252525]">{children}</main>
    </div>
  );
}
