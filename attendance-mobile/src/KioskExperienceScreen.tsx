import {useCallback,useEffect,useRef,useState} from "react";
import {AppState,StyleSheet,View} from "react-native";
import {IdleSchoolDisplay} from "./IdleSchoolDisplay";
import {KioskScreen} from "./KioskScreen";
import {DEFAULT_KIOSK_DISPLAY_SETTINGS,readKioskDisplaySettings,type KioskDisplaySettings} from "./kioskDisplaySettings";
import {loadLiveSchoolSummary,type LiveSchoolSummary} from "./liveSchoolSummary";
import {KioskManager} from "./native";
import type {Registration} from "./types";

type Props={registration:Registration;onReset:()=>void;onOpenSettings?:()=>void};

export function KioskExperienceScreen({registration,onReset,onOpenSettings}:Props){
  const[settings,setSettings]=useState<KioskDisplaySettings>(DEFAULT_KIOSK_DISPLAY_SETTINGS);
  const[idle,setIdle]=useState(false);
  const[summary,setSummary]=useState<LiveSchoolSummary|null>(null);
  const idleTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const mounted=useRef(true);

  const armIdle=useCallback((next=settings)=>{
    if(idleTimer.current)clearTimeout(idleTimer.current);
    if(!next.liveDisplayEnabled)return;
    idleTimer.current=setTimeout(()=>{if(mounted.current)setIdle(true)},next.idleTimeoutMs);
  },[settings]);
  const activity=useCallback(()=>{
    if(idle)setIdle(false);
    armIdle();
  },[armIdle,idle]);
  const refreshSummary=useCallback(async()=>{
    const next=await loadLiveSchoolSummary(registration).catch(()=>null);
    if(next&&mounted.current)setSummary(next);
  },[registration]);
  const restoreKiosk=useCallback(async(next=settings)=>{
    if(!next.kioskEnabled)return;
    await KioskManager.enter().catch(()=>false);
  },[settings]);

  useEffect(()=>{
    mounted.current=true;
    let refreshTimer:ReturnType<typeof setInterval>|null=null;
    (async()=>{
      const saved=await readKioskDisplaySettings();
      if(!mounted.current)return;
      setSettings(saved);
      await restoreKiosk(saved);
      await refreshSummary();
      armIdle(saved);
      refreshTimer=setInterval(()=>void refreshSummary(),saved.refreshIntervalMs);
    })();
    const appState=AppState.addEventListener("change",state=>{
      if(state==="active"){
        void readKioskDisplaySettings().then(next=>{if(!mounted.current)return;setSettings(next);void restoreKiosk(next);armIdle(next)});
        void refreshSummary();
      }
    });
    return()=>{
      mounted.current=false;
      appState.remove();
      if(idleTimer.current)clearTimeout(idleTimer.current);
      if(refreshTimer)clearInterval(refreshTimer);
    };
  },[armIdle,refreshSummary,restoreKiosk]);

  useEffect(()=>{if(idle)void refreshSummary()},[idle,refreshSummary]);

  return <View style={s.root} onStartShouldSetResponderCapture={()=>{activity();return false}}>
    <KioskScreen registration={registration} onReset={onReset} onOpenSettings={onOpenSettings}/>
    {idle&&settings.liveDisplayEnabled?<IdleSchoolDisplay summary={summary} panelIntervalMs={settings.panelIntervalMs} onDismiss={activity}/>:null}
  </View>;
}

const s=StyleSheet.create({root:{flex:1,backgroundColor:"#061c17"}});
