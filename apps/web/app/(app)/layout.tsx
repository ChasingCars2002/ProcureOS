import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  InboxIcon,
  FileTextIcon,
  BuildingIcon,
  ShieldIcon,
  RefreshCwIcon,
  UsersIcon,
} from "lucide-react";

const navItems = [
  { href: "/inbox", label: "Inbox", icon: InboxIcon },
  { href: "/requests", label: "Requests", icon: FileTextIcon },
  { href: "/vendors", label: "Vendors", icon: BuildingIcon },
  { href: "/policies", label: "Policies", icon: ShieldIcon, adminOnly: true },
  { href: "/erp", label: "ERP Sync", icon: RefreshCwIcon, financeOnly: true },
  { href: "/admin", label: "Admin", icon: UsersIcon, adminOnly: true },
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col">
        <div className="px-4 py-5 border-b border-gray-100">
          <span className="font-bold text-lg text-blue-600">FlowProcure</span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-gray-600 rounded-lg hover:bg-gray-50 hover:text-gray-900"
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-gray-100">
          <p className="text-xs text-gray-400 truncate">{user.email}</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
