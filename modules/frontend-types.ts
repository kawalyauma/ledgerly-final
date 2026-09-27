import type { ComponentType, ElementType } from "react";

export type FrontendRoute = {
  scope?: string;
  admin?: boolean;
  view: ComponentType;
};

export type FrontendNavigationItem = {
  label: string;
  path: string;
  scope?: string;
  admin?: boolean;
  icon?: ElementType;
  /** Nested pages rendered as a collapsible branch under this item in the global sidebar. */
  children?: FrontendNavigationItem[];
};

export type FrontendNavigationGroup = {
  /** Stable id used by the per-organization sidebar layout; defaults to "<moduleKey>:<label>". */
  key?: string;
  label: string;
  icon: ElementType;
  order?: number;
  items: FrontendNavigationItem[];
};

export type FrontendGlobalAction = {
  key: string;
  label: string;
  order?: number;
  scope?: string;
  admin?: boolean;
  component: ComponentType<{activePath:string}>;
};

export type FrontendModuleDefinition = {
  key: string;
  name: string;
  version: string;
  order?: number;
  routes: Record<string, FrontendRoute>;
  navigation: FrontendNavigationGroup[];
  /** Optional actions contributed to the global Ledgerly top bar without coupling AppShell to a module. */
  globalActions?: FrontendGlobalAction[];
};
