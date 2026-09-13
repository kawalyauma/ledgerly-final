import {OfflineStore} from "./native";

const SETTINGS_KEY="kiosk.live-display.settings.v1";

export type KioskDisplaySettings={
  kioskEnabled:boolean;
  liveDisplayEnabled:boolean;
  idleTimeoutMs:number;
  refreshIntervalMs:number;
  panelIntervalMs:number;
};

export const DEFAULT_KIOSK_DISPLAY_SETTINGS:KioskDisplaySettings={
  kioskEnabled:true,
  liveDisplayEnabled:true,
  idleTimeoutMs:10_000,
  refreshIntervalMs:20_000,
  panelIntervalMs:6_000,
};

function clamp(value:number,min:number,max:number){return Math.max(min,Math.min(max,value))}

export function normalizeKioskDisplaySettings(input:Partial<KioskDisplaySettings>|null|undefined):KioskDisplaySettings{
  return{
    kioskEnabled:input?.kioskEnabled!==false,
    liveDisplayEnabled:input?.liveDisplayEnabled!==false,
    idleTimeoutMs:clamp(Number(input?.idleTimeoutMs)||DEFAULT_KIOSK_DISPLAY_SETTINGS.idleTimeoutMs,5_000,300_000),
    refreshIntervalMs:clamp(Number(input?.refreshIntervalMs)||DEFAULT_KIOSK_DISPLAY_SETTINGS.refreshIntervalMs,10_000,300_000),
    panelIntervalMs:clamp(Number(input?.panelIntervalMs)||DEFAULT_KIOSK_DISPLAY_SETTINGS.panelIntervalMs,3_000,30_000),
  };
}

export async function readKioskDisplaySettings():Promise<KioskDisplaySettings>{
  try{
    const saved=await OfflineStore.getSecure(SETTINGS_KEY);
    return normalizeKioskDisplaySettings(saved?JSON.parse(saved):null);
  }catch{return DEFAULT_KIOSK_DISPLAY_SETTINGS}
}

export async function saveKioskDisplaySettings(settings:Partial<KioskDisplaySettings>):Promise<KioskDisplaySettings>{
  const current=await readKioskDisplaySettings();
  const next=normalizeKioskDisplaySettings({...current,...settings});
  await OfflineStore.putSecure(SETTINGS_KEY,JSON.stringify(next));
  return next;
}
