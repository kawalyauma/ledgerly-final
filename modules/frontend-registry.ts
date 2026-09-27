import type { FrontendGlobalAction, FrontendModuleDefinition, FrontendNavigationGroup, FrontendRoute } from "./frontend-types";
import { moduleCatalog } from "./catalog.generated";

// Vite expands this at build time. Adding modules/<name>/frontend/module.tsx is enough
// for UI routes/navigation/global actions to be discovered without hard-coding modules in App.tsx or AppShell.tsx.
const discovered = import.meta.glob<{ default: FrontendModuleDefinition }>([
  "./*/frontend/module.tsx",
  "!./agentic-employees/frontend/module.tsx",
], { eager: true });
const activeModuleKeys=new Set(moduleCatalog.filter(module=>module.active).map(module=>module.key));

export const frontendModules = Object.values(discovered)
  .map(entry => entry.default)
  .filter(module=>Boolean(module)&&activeModuleKeys.has(module.key))
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name));

export const appRoutes: Record<string, FrontendRoute> = {};
for (const module of frontendModules) {
  for (const [path, route] of Object.entries(module.routes)) {
    if (appRoutes[path]) throw new Error(`Duplicate frontend route '${path}' from module '${module.key}'.`);
    appRoutes[path] = route;
  }
}

export const appNavigation: FrontendNavigationGroup[] = frontendModules
  .flatMap(module => module.navigation.map(group => ({ ...group, key: group.key ?? `${module.key}:${group.label}` })))
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.label.localeCompare(b.label));

export const appGlobalActions: FrontendGlobalAction[] = frontendModules
  .flatMap(module => (module.globalActions ?? []).map(action => ({ ...action, moduleKey: module.key })))
  .sort((a,b)=>(a.order??100)-(b.order??100)||a.label.localeCompare(b.label));

/** Route key (first hash segment) → the sidebar section that links to it, for plan gating. */
export const routeSections: Record<string, string> = {};
const collectPaths = (items: FrontendNavigationGroup["items"]): string[] => items.flatMap(i => [i.path, ...collectPaths(i.children ?? [])]);
for (const group of appNavigation) {
  for (const path of collectPaths(group.items)) {
    const route = path.split("/")[0]!;
    if (!routeSections[route]) routeSections[route] = group.key!;
  }
}
