import { useEffect, useState } from "react";
import { get } from "./api";

export type SectionSetting = { key: string; visible: boolean };
export type NavigationSettings = { showAll?: boolean; sections?: SectionSetting[] } | null;

/** Sidebar a brand-new school starts with, in this order. */
export const SCHOOL_DEFAULT_SECTIONS = ["ledgerly-core:Dashboards", "school-management:School", "exams:Examinations"];
export const NAVIGATION_CHANGED = "ledgerly:navigation-changed";

/** Visible groups in display order. Unset settings mean the new-school default. */
export function arrangeGroups<T extends { key?: string }>(groups: T[], settings: NavigationSettings): T[] {
  if (settings?.showAll) return groups;
  const byKey = new Map(groups.map(g => [g.key ?? "", g]));
  const order = settings?.sections ? settings.sections.filter(s => s.visible).map(s => s.key) : SCHOOL_DEFAULT_SECTIONS;
  return order.map(key => byKey.get(key)).filter((g): g is T => Boolean(g));
}

/** Full editable list: saved order first, then any sections the saved layout doesn't mention. */
export function editableSections(keys: string[], settings: NavigationSettings): SectionSetting[] {
  if (settings?.showAll) return keys.map(key => ({ key, visible: true }));
  const saved = settings?.sections ?? SCHOOL_DEFAULT_SECTIONS.map(key => ({ key, visible: true }));
  const known = new Set(keys), listed = saved.filter(s => known.has(s.key)), seen = new Set(listed.map(s => s.key));
  return [...listed, ...keys.filter(k => !seen.has(k)).map(key => ({ key, visible: false }))];
}

export function useNavigationSettings(organizationId?: string) {
  const [settings, setSettings] = useState<NavigationSettings | undefined>(undefined);
  useEffect(() => {
    if (!organizationId) return;
    const load = () => get<NavigationSettings>("/workspace/navigation").then(setSettings).catch(() => setSettings({ showAll: true }));
    void load();
    addEventListener(NAVIGATION_CHANGED, load);
    return () => removeEventListener(NAVIGATION_CHANGED, load);
  }, [organizationId]);
  return settings;
}
