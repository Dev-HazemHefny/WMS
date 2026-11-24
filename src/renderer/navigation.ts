import { LayoutDashboard, ArrowLeftRight, Package, FolderTree, Ruler, Tag, Layers, Boxes, ScanBarcode, Building2, Network, type LucideIcon } from "lucide-react";
import type { SessionPermission } from "../shared/identity/types";
import { useSession } from "./session-context";

export const navigation: { to: string; label: string; end?: boolean; icon: LucideIcon; permission?: SessionPermission }[] = [
  { to: "/", label: "نظرة عامة", end: true, icon: LayoutDashboard },
  { to: "/inventory", label: "المخزون", icon: ArrowLeftRight, permission: "read" },
  { to: "/branches", label: "الفروع", icon: Network },
  { to: "/warehouses", label: "المخازن ومواقع التخزين", icon: Building2 },
  { to: "/products", label: "الأصناف", icon: Package },
  { to: "/categories", label: "التصنيفات", icon: FolderTree },
  { to: "/units", label: "وحدات القياس", icon: Ruler },
  { to: "/brands", label: "العلامات التجارية", icon: Tag },
  { to: "/variants", label: "المتغيرات", icon: Layers },
  { to: "/packaging", label: "وحدات التعبئة", icon: Boxes },
  { to: "/barcodes", label: "الباركود", icon: ScanBarcode }
];

export function useVisibleNavigation() {
  const { can } = useSession();
  return navigation.filter(item => !item.permission || can(item.permission));
}

