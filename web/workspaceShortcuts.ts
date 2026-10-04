export type WorkspaceShortcut={path:string;label:string;group:string;visitedAt:number};
type WorkspaceShortcutState={favorites:WorkspaceShortcut[];recent:WorkspaceShortcut[]};
export const WORKSPACE_SHORTCUTS_CHANGED="ledgerly:workspace-shortcuts-changed";

const empty=():WorkspaceShortcutState=>({favorites:[],recent:[]});
const key=(organizationId?:string,userId?:string)=>`ledgerly.workspace-shortcuts:${organizationId||"none"}:${userId||"anonymous"}`;
const valid=(value:unknown):value is WorkspaceShortcut=>!!value&&typeof value==="object"&&typeof(value as WorkspaceShortcut).path==="string"&&typeof(value as WorkspaceShortcut).label==="string";

export function readWorkspaceShortcuts(organizationId?:string,userId?:string):WorkspaceShortcutState{
  try{const value=JSON.parse(localStorage.getItem(key(organizationId,userId))||"null") as Partial<WorkspaceShortcutState>|null;return{favorites:Array.isArray(value?.favorites)?value.favorites.filter(valid).slice(0,12):[],recent:Array.isArray(value?.recent)?value.recent.filter(valid).slice(0,12):[]}}catch{return empty()}
}
function save(organizationId:string|undefined,userId:string|undefined,state:WorkspaceShortcutState){try{localStorage.setItem(key(organizationId,userId),JSON.stringify(state));dispatchEvent(new CustomEvent(WORKSPACE_SHORTCUTS_CHANGED))}catch{}return state}
export function recordWorkspaceVisit(organizationId:string|undefined,userId:string|undefined,page:Omit<WorkspaceShortcut,"visitedAt">){
  const state=readWorkspaceShortcuts(organizationId,userId),next={...page,visitedAt:Date.now()};
  return save(organizationId,userId,{...state,recent:[next,...state.recent.filter(item=>item.path!==page.path)].slice(0,12)});
}
export function toggleWorkspaceFavorite(organizationId:string|undefined,userId:string|undefined,page:Omit<WorkspaceShortcut,"visitedAt">){
  const state=readWorkspaceShortcuts(organizationId,userId),exists=state.favorites.some(item=>item.path===page.path);
  return save(organizationId,userId,{...state,favorites:exists?state.favorites.filter(item=>item.path!==page.path):[{...page,visitedAt:Date.now()},...state.favorites].slice(0,12)});
}
