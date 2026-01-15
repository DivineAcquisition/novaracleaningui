"use client";

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/components/admin-portal/AdminSidebar";
import { AdminHeader } from "@/components/admin-portal/AdminHeader";
import { AdminProtectedRoute } from "@/components/admin-portal/AdminProtectedRoute";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AdminProtectedRoute>
      <SidebarProvider>
        <AdminSidebar />
        <SidebarInset>
          <AdminHeader />
          <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </AdminProtectedRoute>
  );
}
