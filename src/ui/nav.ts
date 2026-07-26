import {
  CircleHelp,
  Clapperboard,
  Brain,
  Columns2,
  FileUp,
  FlaskConical,
  Layers,
  Library,
  Radar,
  Save,
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
  { to: '/lab', label: 'Packet Lab', icon: FlaskConical },
  { to: '/practice', label: 'Packet Practice', icon: Brain },
  { to: '/compare', label: 'Packet Comparison', icon: Columns2 },
  { to: '/library', label: 'Protocol Library', icon: Library },
  { to: '/map', label: 'Encapsulation Map', icon: Waypoints },
  { to: '/import', label: 'Import Spec', icon: FileUp },
  { to: '/workspace', label: 'Workspace', icon: Save },
  { to: '/help', label: 'Help', icon: CircleHelp },
];
