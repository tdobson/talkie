import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import { requireAdminPage } from '@/lib/auth/guard';

export const metadata: Metadata = { title: 'Video feedback admin' };
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdminPage();
  return <AdminShell>{children}</AdminShell>;
}
