import { requireOrg } from "@/lib/auth/guards";
import { AppSidebar } from "@/components/app-sidebar";
import { AppHeaderTitle } from "@/components/app-header-title";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, organizationId } = await requireOrg();

  return (
    <SidebarProvider>
      <AppSidebar
        userName={user.name}
        userEmail={user.email}
        organizationId={organizationId}
      />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mx-2 h-4" />
          <AppHeaderTitle />
        </header>
        <main className="flex-1 p-4 sm:p-6">
          <div className="mx-auto w-full max-w-screen-2xl">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
