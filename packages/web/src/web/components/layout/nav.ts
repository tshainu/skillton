import {
  Archive,
  ArrowLeftRight,
  BarChart3,
  Bot,
  Briefcase,
  Building2,
  ClipboardCheck,
  Cpu,
  FileBarChart,
  Flag,
  Gem,
  Mic,
  Settings,
  Sparkles,
  Trophy,
  Users,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Roles allowed to see the item. Empty = everyone signed in. */
  roles?: string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
      { href: "/copilot", label: "AI Copilot", icon: Sparkles },
    ],
  },
  {
    label: "Sourcing",
    items: [
      { href: "/clients", label: "Clients", icon: Building2 },
      { href: "/jobs", label: "Job Descriptions", icon: Briefcase },
      { href: "/candidates", label: "Candidates", icon: Users },
      { href: "/matching", label: "Matching Engine", icon: Cpu },
      { href: "/matrix", label: "JD CV Matrix", icon: ArrowLeftRight },
    ],
  },
  {
    label: "Interviews",
    items: [
      { href: "/screening", label: "HR Screening", icon: ClipboardCheck },
      { href: "/ai-interviews", label: "AI Interview", icon: Mic },
      { href: "/tech-interviews", label: "Technical", icon: Bot },
      { href: "/flagged", label: "Flagged Candidates", icon: Flag },
    ],
  },
  {
    label: "Outcomes",
    items: [
      { href: "/placed", label: "Placed", icon: Trophy },
      { href: "/hidden-gems", label: "Hidden Gems", icon: Gem },
      { href: "/reports", label: "Reports", icon: FileBarChart },
      { href: "/operations", label: "Operations", icon: Wrench },
      { href: "/settings", label: "Settings", icon: Settings },
      {
        href: "/backup",
        label: "Backup & Recovery",
        icon: Archive,
        roles: ["super_admin", "agency_admin"],
      },
    ],
  },
];

export function visibleNav(role: string | undefined): NavGroup[] {
  return NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.roles || (role && item.roles.includes(role))),
  })).filter((group) => group.items.length > 0);
}
