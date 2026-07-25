import {
  CircleHelp,
  Clapperboard,
  Columns2,
  FileUp,
  Layers,
  Library,
  Radar,
  Scissors,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** Primary views, shown in the sidebar and offered as palette navigation. */
export const NAV: NavItem[] = [
  { to: '/builder', label: 'Stack Builder', icon: Layers },
  { to: '/scenario', label: 'Scenario Timeline', icon: Clapperboard },
  { to: '/capture', label: 'Capture Viewer', icon: Radar },
  { to: '/fragmentation', label: 'Fragmentation Lab', icon: Scissors },
  { to: '/compare', label: 'Packet Comparison', icon: Columns2 },
  { to: '/library', label: 'Protocol Library', icon: Library },
  { to: '/map', label: 'Encapsulation Map', icon: Waypoints },
  { to: '/import', label: 'Import Spec', icon: FileUp },
  { to: '/help', label: 'Help', icon: CircleHelp },
];
