"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Megaphone,
  Users,
  Inbox,
  Settings,
  Globe,
  LogOut,
  KanbanSquare,
  Bot,
  Send,
  MessageSquareText,
  Mailbox,
  CalendarCheck,
  Repeat,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useStackApp } from "@stackframe/stack";

const navGroups: {
  label: string;
  items: { href: string; label: string; icon: typeof LayoutDashboard }[];
}[] = [
  {
    label: "Prospecção",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/mining", label: "Mineração", icon: Megaphone },
      { href: "/leads", label: "Leads", icon: Users },
      { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
    ],
  },
  {
    label: "Abordagem",
    items: [
      { href: "/outreach", label: "Campanhas", icon: Mailbox },
      { href: "/outreach/plan", label: "Plano do dia", icon: CalendarCheck },
      { href: "/inbox", label: "Inbox", icon: Inbox },
      { href: "/disparos", label: "Disparos", icon: Send },
      { href: "/mensagens", label: "Mensagens", icon: MessageSquareText },
    ],
  },
  {
    label: "Configuração",
    items: [
      { href: "/settings/automation", label: "Automação", icon: Repeat },
      { href: "/settings/agent", label: "Agente", icon: Bot },
      { href: "/settings/credentials", label: "Credenciais", icon: Settings },
      { href: "/settings/credentials/browser", label: "Navegador", icon: Globe },
    ],
  },
];

export function AppSidebar({
  userName,
  userEmail,
  organizationId,
}: {
  userName: string;
  userEmail: string;
  organizationId: string;
}) {
  const pathname = usePathname();
  const app = useStackApp();

  // Item ativo = href que casa com o prefixo mais longo do pathname atual.
  // Evita que /outreach e /outreach/plan fiquem ativos ao mesmo tempo.
  const allHrefs = navGroups.flatMap((g) => g.items.map((i) => i.href));
  const activeHref = allHrefs
    .filter((h) => pathname === h || pathname.startsWith(h + "/"))
    .sort((a, b) => b.length - a.length)[0];

  async function handleSignOut() {
    await app.signOut();
    window.location.href = "/sign-in";
  }

  const initials = userName
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <Megaphone className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight">Minerador</p>
            <p className="text-[11px] text-muted-foreground truncate leading-tight">
              org {organizationId.slice(0, 8)}
            </p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = item.href === activeHref;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={active}
                        className={
                          active
                            ? "relative font-medium before:absolute before:left-0 before:top-1/2 before:h-4 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-sidebar-primary"
                            : undefined
                        }
                        render={
                          <Link href={item.href}>
                            <Icon />
                            <span>{item.label}</span>
                          </Link>
                        }
                      />
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-2 px-2 py-2">
          <Avatar className="h-8 w-8">
            <AvatarFallback>{initials || "U"}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{userName}</p>
            <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSignOut}
            aria-label="Sair"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
