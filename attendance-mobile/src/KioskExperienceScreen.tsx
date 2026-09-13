import {useCallback,useEffect,useRef,useState} from "react";
import {AppState,StyleSheet,View} from "react-native";
import {IdleSchoolDisplay} from "./IdleSchoolDisplay";
import {KioskScreen} from "./KioskScreen";
import {DEFAULT_KIOSK_DISPLAY_SETTINGS,readKioskDisplaySettings,type KioskDisplaySettings} from "./kioskDisplaySettings";
import {loadLiveSchoolSummary,type LiveSchoolSummary} from "./liveSchoolSummary";
import {KioskManager} from "./native";
import type {Registration} from "./types";

type Props={registration:Registration;onReset:()=>void;onOpenSettings?:()=>void;onRequestPinLock?:()=>void};

export function KioskExperienceScreen({registration,onReset,onOpenSettings,onRequestPinLock}:Props){
  const[settings,setSettings]=useState<KioskDisplaySettings>(DEFAULT_KIOSK_DISPLAY_SETTINGS);
  const[idle,setIdle]=useState(false);
  const[summary,setSummary]=useState<LiveSchoolSummary|null>(null);
  const idleTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const refreshTimer=useRef<ReturnType<typeof setInterval>|null>(null);
  const mounted=useRef(true);
  const settingsRef=useRef<KioskDisplaySettings>(DEFAULT_KIOSK_DISPLAY_SETTINGS);

  const armIdle=useCallback((next?:KioskDisplaySettings)=>{
    const active=next||settingsRef.current;
    if(idleTimer.current)clearTimeout(idleTimer.current);
    if(!active.liveDisplayEnabled)return;
    idleTimer.current=setTimeout(()=>{if(mounted.current)setIdle(true)},active.idleTimeoutMs);
  },[]);
  const activity=useCallback(()=>{setIdle(false);armIdle()},[armIdle]);
  const requestPinLock=useCallback(()=>{
    setIdle(false);
    if(idleTimer.current){clearTimeout(idleTimer.current);idleTimer.current=null}
    if(onRequestPinLock)onRequestPinLock();else armIdle();
  },[armIdle,onRequestPinLock]);
  const refreshSummary=useCallback(async()=>{
    const next=await loadLiveSchoolSummary(registration).catch(()=>null);
    if(next&&mounted.current)setSummary(next);
  },[registration]);
  const restoreKiosk=useCallback(async(next?:KioskDisplaySettings)=>{
    const active=next||settingsRef.current;
    if(!active.kioskEnabled)return;
    await KioskManager.enter().catch(()=>false);
  },[]);
  const applySettings=useCallback((next:KioskDisplaySettings)=>{
    settingsRef.current=next;
    setSettings(next);
    armIdle(next);
    if(refreshTimer.current)clearInterval(refreshTimer.current);
    refreshTimer.current=setInterval(()=>void refreshSummary(),next.refreshIntervalMs);
  },[armIdle,refreshSummary]);

  useEffect(()=>{
    mounted.current=true;
    (async()=>{
      const saved=await readKioskDisplaySettings();
      if(!mounted.current)return;
      applySettings(saved);
      await restoreKiosk(saved);
      await refreshSummary();
    })();
    const appState=AppState.addEventListener("change",state=>{
      if(state!=="active")return;
      void readKioskDisplaySettings().then(next=>{
        if(!mounted.current)return;
        applySettings(next);
        void restoreKiosk(next);
      });
      void refreshSummary();
    });
    return()=>{
      mounted.current=false;
      appState.remove();
      if(idleTimer.current)clearTimeout(idleTimer.current);
      if(refreshTimer.current)clearInterval(refreshTimer.current);
    };
  },[applySettings,refreshSummary,restoreKiosk]);

  useEffect(()=>{if(idle)void refreshSummary()},[idle,refreshSummary]);

  return <View style={s.root} onStartShouldSetResponderCapture={()=>{if(!idle)activity();return false}}>
    <KioskScreen registration={registration} onReset={onReset} onOpenSettings={onOpenSettings}/>
    {idle&&settings.liveDisplayEnabled?<IdleSchoolDisplay summary={summary} panelIntervalMs={settings.panelIntervalMs} onDismiss={requestPinLock}/>:null}
  </View>;
}

const s=StyleSheet.create({root:{flex:1,backgroundColor:"#061c17"}});
