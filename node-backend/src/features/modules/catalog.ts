export type NodeModuleCatalogEntry={key:string;name:string;version:string;description:string;category:string;core:boolean;active:boolean;manifest:Record<string,unknown>};

/** Standalone Node catalog. Keep this independent from the Cloudflare module registry. */
export const nodeModuleCatalog:NodeModuleCatalogEntry[]=[
  {
    key:"contacts",name:"Contacts",version:"1.0.0",description:"Shared people and organizations directory assembled from enabled capabilities.",category:"platform",core:true,active:true,
    manifest:{standalone:true,owns:["contacts","contact_people","contact_addresses"],discoversEnabledModules:true,contactSources:{"ledgerly-core":["customer","supplier","employee","other"]}},
  },
  {
    key:"ledgerly-core",name:"Ledgerly Finance Core",version:"1.0.0",description:"Self-hosted core accounting, finance operations and authoritative offline finance projections.",category:"finance",core:true,active:true,
    manifest:{standalone:true,requiresModules:["contacts"],offline:true,mobileSourceOfTruth:"server",offlineWritable:["document-intents","journal-intents"],offlineForbidden:["posting","reversals","period-closing","bank-reconciliation","approvals"],features:["chart-of-accounts","journals","documents","banking","budgets","fiscal-periods","inventory","tax","reports","projects","dimensions","fixed-assets","integrations"]},
  },
];

export function catalogModule(key:string){return nodeModuleCatalog.find(module=>module.key===key);}
export function moduleDependencies(key:string){const manifest=catalogModule(key)?.manifest??{},raw=Array.isArray(manifest.requiresModules)?manifest.requiresModules:Array.isArray(manifest.requiresDataFrom)?manifest.requiresDataFrom:[];return [...new Set(raw.map(String).filter(Boolean))];}
