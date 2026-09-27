import { useEffect, useState } from "react";
import { get } from "./api";

import { NAVIGATION_CHANGED, type NavigationSettings } from "./navigationLayout";
export * from "./navigationLayout";

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
