import type { AuthPrincipal, Env } from "../../../src/types";
import type { AgentDefinition } from "./policy";
import { openAiTools } from "./memory-tools-v17";

export type LightTaskKind = "query" | "report" | "create" | "update" | "delete" | "action" | "communication" | "document" | "analysis";
export type LightToolSource = "route" | "native";

export type LightToolDescriptor = {
  name: string;
  description: string;
  kind: LightTaskKind;
  module: string;
  group: string;
  source: LightToolSource;
  readOnly: boolean;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  pathTemplate?: string;
  nativeName?: string;
  parameters?: Record<string, unknown>;
  aliases: string[];
};

export type LightToolRegistry = {
  tools: LightToolDescriptor[];
  kinds: LightTaskKind[];
  modules: string[];
  groupsByModule: Record<string, string[]>;
  stats: { total: number; routeTools: number; nativeTools: number; writes: number; reads: number };
};

const ACTION_WORDS = new Set(["approve","reject","publish","apply","execute","reverse","void","close","reopen","archive","restore","promote","transfer","assign","unassign","send","submit","activate","deactivate","finalize","post","allocate","reconcile","reschedule","substitute"]);
const QUERY_WORDS = new Set(["search","lookup","preview","calculate","validate","check","summary","matrix","context","options","status"]);
const REPORT_WORDS = new Set(["report","reports","statement","statements","analytics","dashboard","summary"]);
const DOC_WORDS = new Set(["document","documents","files","pdf","xlsx","pptx","docx","print","printerly"]);
const ADVANCED_DISCOVERY_TOOLS = new Set(["system_catalog","system_read","prepare_system_action"]);

function tokens(path: string) {
  return path.split("?")[0].split("/").filter(Boolean).slice(2).map(part => part.replace(/^:/, "by_").replace(/[^A-Za-z0-9_-]+/g, "_").toLowerCase());
}

function cleanToken(value: string) {
  return value.replace(/^by_/, "").replace(/[-_]+/g, " ").trim();
}

function hashText(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36).slice(0, 7);
}

function pathWords(path: string) {
  return tokens(path).filter(part => !part.startsWith("by_")).map(cleanToken);
}

function routeKind(method: string, path: string): LightTaskKind {
  const words = pathWords(path);
  const last = words[words.length - 1] || "";
  if (words.some(word => DOC_WORDS.has(word)) && method !== "GET") return "document";
  if (words.some(word => word === "communications" || word === "communication" || word === "campaigns") && method !== "GET") return "communication";
  if (method === "GET") return words.some(word => REPORT_WORDS.has(word)) ? "report" : "query";
  if (ACTION_WORDS.has(last) || words.some(word => ACTION_WORDS.has(word))) return "action";
  if (method === "DELETE") return "delete";
  if (method === "PATCH" || method === "PUT") return "update";
  if (method === "POST" && QUERY_WORDS.has(last)) return "query";
  return "create";
}

function moduleFor(path: string) {
  const parts = tokens(path).filter(part => !part.startsWith("by_"));
  return cleanToken(parts[0] || "system") || "system";
}

function groupFor(path: string) {
  const parts = tokens(path).filter(part => !part.startsWith("by_"));
  if (!parts.length) return "general";
  if (parts[0] === "school") return cleanToken(parts[1] || "general") || "general";
  return cleanToken(parts[1] || parts[0] || "general") || "general";
}

function verbFor(method: string, kind: LightTaskKind) {
  if (kind === "report") return "report";
  if (kind === "query") return "get";
  if (kind === "create") return "create";
  if (kind === "update") return "update";
  if (kind === "delete") return "delete";
  if (kind === "communication") return "communicate";
  if (kind === "document") return "document";
  if (kind === "action") return "action";
  return method.toLowerCase();
}

function routeName(method: string, path: string, kind: LightTaskKind) {
  const parts = tokens(path).join("_");
  const base = `${verbFor(method, kind)}_${parts}`.replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 72);
  return `route_${base}_${hashText(`${method}:${path}`)}`;
}

function routeDescription(method: string, path: string, kind: LightTaskKind) {
  const readable = pathWords(path).join(" → ") || "Ledgerly";
  const action = kind === "query" ? "Read" : kind === "report" ? "Get report data from" : kind === "create" ? "Create in" : kind === "update" ? "Update in" : kind === "delete" ? "Delete from" : kind === "communication" ? "Prepare communication through" : kind === "document" ? "Prepare document work through" : "Perform a governed action in";
  return `${action} ${readable}. Route: ${method.toUpperCase()} ${path}`;
}

function routeAliases(method: string, path: string, kind: LightTaskKind) {
  const words = pathWords(path);
  const noun = words.slice(-2).join(" ");
  const aliases = new Set<string>([noun, words.join(" "), `${verbFor(method, kind)} ${noun}`]);
  if (kind === "create") { aliases.add(`add ${noun}`); aliases.add(`new ${noun}`); aliases.add(`register ${noun}`); aliases.add(`open ${noun}`); }
  if (kind === "query") { aliases.add(`check ${noun}`); aliases.add(`find ${noun}`); aliases.add(`show ${noun}`); }
  if (kind === "update") { aliases.add(`edit ${noun}`); aliases.add(`change ${noun}`); aliases.add(`rename ${noun}`); }
  if (kind === "delete") aliases.add(`remove ${noun}`);
  return [...aliases].filter(Boolean).slice(0, 8);
}

function nativeKind(name: string, description: string): LightTaskKind {
  const text = `${name} ${description}`.toLowerCase();
  if (name === "prepare_document" || name === "prepare_print_document" || text.includes("document")) return "document";
  if (name === "prepare_communication" || text.includes("communication campaign")) return "communication";
  if (name.startsWith("prepare_") || name.startsWith("remember_") || name.startsWith("update_")) return name.startsWith("update_") ? "update" : "action";
  if (text.includes("report")) return "report";
  if (text.includes("analy") || text.includes("intelligence") || name === "delegate_to_employee") return "analysis";
  return "query";
}

function nativeModule(name: string) {
  if (name.includes("fee_") || name.includes("arrears") || name.includes("collection")) return "finance";
  if (name.includes("academic") || name.includes("lesson") || name.includes("scheme") || name.includes("timetable")) return "academics";
  if (name.includes("staff") || name.includes("hr_")) return "human resources";
  if (name.includes("book")) return "books";
  if (name.includes("communication")) return "communications";
  if (name.includes("student") || name.includes("guardian") || name.includes("family") || name.includes("school_")) return "school";
  if (name.includes("document") || name.includes("print")) return "documents";
  if (name.includes("memory")) return "memory";
  if (name.includes("work_task")) return "tasks";
  return "general";
}

function nativeGroup(name: string, module: string) {
  if (name.includes("fee")) return "fees";
  if (name.includes("timetable")) return "timetable";
  if (name.includes("lesson")) return "lesson plans";
  if (name.includes("scheme")) return "schemes";
  if (name.includes("guardian") || name.includes("family")) return "families";
  if (name.includes("student")) return "students";
  if (name.includes("staff") || name.includes("hr_")) return "staff";
  if (name.includes("document")) return "documents";
  if (name.includes("memory")) return "memory";
  return module;
}

function nativeAliases(name: string, description: string) {
  const readable = name.replace(/_/g, " ");
  const values = new Set<string>([readable, description.toLowerCase().slice(0, 180)]);
  if (name.startsWith("search_")) values.add(`find ${readable.replace(/^search /, "")}`);
  if (name.startsWith("prepare_")) values.add(`create ${readable.replace(/^prepare /, "")}`);
  return [...values];
}

export async function buildLightToolRegistry(env: Env, principal: AuthPrincipal, agent: AgentDefinition): Promise<LightToolRegistry> {
  const nativeSpecs = (openAiTools(agent, null) as Array<{ name: string; description?: string; parameters?: Record<string, unknown> }>).filter(spec => !ADVANCED_DISCOVERY_TOOLS.has(spec.name));
  const nativeTools: LightToolDescriptor[] = nativeSpecs.map(spec => {
    const description = spec.description || spec.name.replace(/_/g, " ");
    const kind = nativeKind(spec.name, description);
    const module = nativeModule(spec.name);
    return {
      name: spec.name,
      description,
      kind,
      module,
      group: nativeGroup(spec.name, module),
      source: "native",
      readOnly: !spec.name.startsWith("prepare_") && !spec.name.startsWith("remember_") && !spec.name.startsWith("update_"),
      nativeName: spec.name,
      parameters: spec.parameters || { type: "object", properties: {} },
      aliases: nativeAliases(spec.name, description),
    };
  });

  const gateway = env.AGENT_SYSTEM_GATEWAY;
  const routes = gateway ? await gateway.catalog(agent.key, principal) : [];
  const routeTools: LightToolDescriptor[] = routes.map(route => {
    const method = String(route.method || "GET").toUpperCase() as "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    const path = String(route.path || "");
    const kind = routeKind(method, path);
    return {
      name: routeName(method, path, kind),
      description: routeDescription(method, path, kind),
      kind,
      module: moduleFor(path),
      group: groupFor(path),
      source: "route",
      readOnly: method === "GET" || (method === "POST" && kind === "query"),
      method,
      pathTemplate: path,
      aliases: routeAliases(method, path, kind),
    };
  });

  const byKey = new Map<string, LightToolDescriptor>();
  for (const tool of [...nativeTools, ...routeTools]) byKey.set(`${tool.source}:${tool.name}`, tool);
  const tools = [...byKey.values()];
  const kinds = [...new Set(tools.map(tool => tool.kind))].sort() as LightTaskKind[];
  const modules = [...new Set(tools.map(tool => tool.module))].sort();
  const groupsByModule: Record<string, string[]> = {};
  for (const module of modules) groupsByModule[module] = [...new Set(tools.filter(tool => tool.module === module).map(tool => tool.group))].sort();
  return {
    tools,
    kinds,
    modules,
    groupsByModule,
    stats: {
      total: tools.length,
      routeTools: routeTools.length,
      nativeTools: nativeTools.length,
      writes: tools.filter(tool => !tool.readOnly).length,
      reads: tools.filter(tool => tool.readOnly).length,
    },
  };
}

export function toolsForKind(registry: LightToolRegistry, kinds: LightTaskKind[]) {
  const wanted = new Set(kinds);
  return registry.tools.filter(tool => wanted.has(tool.kind));
}

export function toolsForModules(tools: LightToolDescriptor[], modules: string[]) {
  const wanted = new Set(modules);
  return tools.filter(tool => wanted.has(tool.module));
}

export function toolsForGroups(tools: LightToolDescriptor[], groups: string[]) {
  const wanted = new Set(groups);
  return tools.filter(tool => wanted.has(tool.group));
}
