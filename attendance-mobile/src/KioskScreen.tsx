import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {AppState,SafeAreaView,StyleSheet,Text,TextInput,TouchableOpacity,View} from "react-native";
import {fetchBootstrap} from "./api";
import {DeviceManager,KioskManager,OfflineStore} from "./native";
import {cacheBootstrap,cachedBootstrap,enqueue,eventId} from "./storage";
import {flush} from "./sync";
import type {AttendanceEvent,Bootstrap,Direction,Registration,RosterPerson} from "./types";

type Result={person:RosterPerson;direction:Direction};

export function KioskScreen({registration,onReset,onOpenSettings}:{registration:Registration;onReset:()=>void;onOpenSettings?:()=>void}){
  const[bootstrap,setBootstrap]=useState<Bootstrap|null>(null);
  const[pendingCount,setPendingCount]=useState(0),[failedCount,setFailedCount]=useState(0),[online,setOnline]=useState(false);
  const[direction,setDirection]=useState<Direction>("IN"),[result,setResult]=useState<Result|null>(null),[error,setError]=useState("");
  const[query,setQuery]=useState(""),[selectedPerson,setSelectedPerson]=useState<RosterPerson|null>(null);
  const[logoTaps,setLogoTaps]=useState(0),[exitOpen,setExitOpen]=useState(false),[exitPin,setExitPin]=useState("");
  const busy=useRef(false);

  const syncNow=useCallback(async()=>{
    try{
      const r=await flush(registration);
      setPendingCount(r.remaining);
      setFailedCount(r.failed);
      setOnline(true);
    }catch{
      setOnline(false);
      setPendingCount(await OfflineStore.count());
      setFailedCount(await OfflineStore.failedCount());
    }
  },[registration]);

  const refresh=useCallback(async()=>{
    try{
      const fresh=await fetchBootstrap(registration);
      setBootstrap(fresh);
      await cacheBootstrap(fresh);
      setOnline(true);
      if(fresh.device.direction!=="BOTH")setDirection(fresh.device.direction);
      await syncNow();
    }catch(e){
      setOnline(false);
      setError(e instanceof Error?e.message:String(e));
      const cached=await cachedBootstrap();
      if(cached){
        setBootstrap(cached);
        if(cached.device.direction!=="BOTH")setDirection(cached.device.direction);
      }
    }
  },[registration,syncNow]);

  const roster=bootstrap?.roster||[];
  const studentCount=useMemo(()=>roster.filter(p=>!p.staffNumber).length,[roster]);
  const staffCount=useMemo(()=>roster.filter(p=>!!p.staffNumber).length,[roster]);
  const matches=useMemo(()=>{
    const q=query.trim().toLowerCase();
    if(!q)return[];
    return roster.filter(p=>[p.name,p.admissionNumber,p.studentNumber,p.staffNumber,p.groupName]
      .some(v=>String(v||"").toLowerCase().includes(q))).slice(0,10);
  },[query,roster]);

  const record=useCallback(async(person:RosterPerson)=>{
    if(busy.current)return;
    busy.current=true;
    setError("");
    try{
      const event:AttendanceEvent={
        clientEventId:eventId(),
        personType:person.staffNumber?"staff":"student",
        personId:person.id,
        direction,
        method:"MANUAL",
        verificationMode:"SUPERVISED",
        capturedAt:new Date().toISOString(),
        metadata:{deviceCapturedOffline:!online,entryMode:"NAME_LOOKUP"}
      };
      setPendingCount(await enqueue(event));
      setResult({person,direction});
      setQuery("");
      setSelectedPerson(null);
      void syncNow();
      setTimeout(()=>setResult(null),2400);
    }catch(e){
      setError(e instanceof Error?e.message:String(e));
    }finally{
      busy.current=false;
    }
  },[direction,online,syncNow]);

  useEffect(()=>{
    void refresh();
    void KioskManager.enter().catch(()=>{});
    const timer=setInterval(()=>void syncNow(),20000);
    const state=AppState.addEventListener("change",value=>{
      if(value==="active"){
        void KioskManager.enter().catch(()=>{});
        void syncNow();
      }
    });
    return()=>{state.remove();clearInterval(timer)};
  },[refresh,syncNow]);

  function tapLogo(){
    const next=logoTaps+1;
    if(next>=5){setExitOpen(true);setLogoTaps(0)}
    else{setLogoTaps(next);setTimeout(()=>setLogoTaps(0),2500)}
  }

  async function exit(){
    if(!await DeviceManager.verifyExitPin(exitPin)){setError("Incorrect administrator PIN");return}
    await KioskManager.exit();
    setExitOpen(false);
    setExitPin("");
    onOpenSettings?.();
  }

  return <SafeAreaView style={s.root}>
    <View style={s.header}>
      <TouchableOpacity onPress={tapLogo} activeOpacity={.8}>
        <Text style={s.brand}>ledgerly</Text>
        <Text style={s.brandSub}>ATTENDANCE</Text>
      </TouchableOpacity>
      <View style={s.headerRight}>
        <Text style={s.location}>{bootstrap?.device.name||"Attendance kiosk"}</Text>
        <View style={s.statusLine}>
          <View style={[s.statusDot,online?s.statusOnline:s.statusOffline]}/>
          <Text style={s.statusText}>{online?"Online":"Offline mode"}</Text>
          {pendingCount?<Text style={s.statusText}> · {pendingCount} waiting</Text>:null}
        </View>
      </View>
    </View>

    <View style={s.hero}>
      <View style={s.heroCopy}>
        <Text style={s.eyebrow}>WELCOME</Text>
        <Text style={s.heroTitle}>Find your name</Text>
        <Text style={s.heroText}>Search your name, select your profile, then confirm whether you are arriving or leaving.</Text>
      </View>
      <View style={s.summaryRow}>
        <View style={s.summaryCard}><Text style={s.summaryValue}>{roster.length}</Text><Text style={s.summaryLabel}>People</Text></View>
        <View style={s.summaryCard}><Text style={s.summaryValue}>{studentCount}</Text><Text style={s.summaryLabel}>Students</Text></View>
        <View style={s.summaryCard}><Text style={s.summaryValue}>{staffCount}</Text><Text style={s.summaryLabel}>Staff</Text></View>
      </View>
    </View>

    <View style={s.directionWrap}>
      <Text style={s.sectionLabel}>WHAT ARE YOU DOING?</Text>
      <View style={s.segment}>
        <TouchableOpacity disabled={bootstrap?.device.direction!=="BOTH"&&bootstrap?.device.direction!=="IN"} style={[s.segmentButton,direction==="IN"&&s.segmentActive]} onPress={()=>setDirection("IN")}>
          <Text style={[s.segmentIcon,direction==="IN"&&s.segmentTextActive]}>↓</Text>
          <View><Text style={[s.segmentTitle,direction==="IN"&&s.segmentTextActive]}>Arriving</Text><Text style={[s.segmentHint,direction==="IN"&&s.segmentHintActive]}>Check in</Text></View>
        </TouchableOpacity>
        <TouchableOpacity disabled={bootstrap?.device.direction!=="BOTH"&&bootstrap?.device.direction!=="OUT"} style={[s.segmentButton,direction==="OUT"&&s.segmentActive]} onPress={()=>setDirection("OUT")}>
          <Text style={[s.segmentIcon,direction==="OUT"&&s.segmentTextActive]}>↑</Text>
          <View><Text style={[s.segmentTitle,direction==="OUT"&&s.segmentTextActive]}>Leaving</Text><Text style={[s.segmentHint,direction==="OUT"&&s.segmentHintActive]}>Check out</Text></View>
        </TouchableOpacity>
      </View>
    </View>

    <View style={s.searchCard}>
      <Text style={s.searchTitle}>Search school directory</Text>
      <Text style={s.searchHelp}>Start typing your name. You can also use an admission or staff number.</Text>
      <View style={s.searchBox}>
        <Text style={s.searchGlyph}>⌕</Text>
        <TextInput
          style={s.searchInput}
          value={query}
          onChangeText={value=>{setQuery(value);setSelectedPerson(null);setError("")}}
          placeholder="Type your name…"
          placeholderTextColor="#7f948a"
          autoCapitalize="words"
          autoCorrect={false}
        />
        {query?<TouchableOpacity onPress={()=>{setQuery("");setSelectedPerson(null)}}><Text style={s.clear}>×</Text></TouchableOpacity>:null}
      </View>

      {query.trim()&&!selectedPerson?<View style={s.results}>
        {matches.length?matches.map(person=><TouchableOpacity key={`${person.staffNumber?"staff":"student"}:${person.id}`} style={s.resultRow} onPress={()=>{setSelectedPerson(person);setQuery(person.name);setError("")}}>
          <View style={s.smallAvatar}><Text style={s.smallAvatarText}>{person.name.split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase()}</Text></View>
          <View style={s.resultCopy}><Text style={s.resultName}>{person.name}</Text><Text style={s.resultMeta}>{person.staffNumber?"Staff":"Student"}{person.groupName?` · ${person.groupName}`:""}</Text></View>
          <Text style={s.chevron}>›</Text>
        </TouchableOpacity>):<View style={s.empty}><Text style={s.emptyTitle}>No match found</Text><Text style={s.emptyText}>Check the spelling or ask an administrator to confirm your school record.</Text></View>}
      </View>:null}

      {selectedPerson?<View style={s.personCard}>
        <View style={s.avatar}><Text style={s.avatarText}>{selectedPerson.name.split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase()}</Text></View>
        <Text style={s.personName}>{selectedPerson.name}</Text>
        <Text style={s.personType}>{selectedPerson.staffNumber?"STAFF MEMBER":"STUDENT"}</Text>
        <View style={s.personFacts}>
          <View style={s.fact}><Text style={s.factLabel}>NUMBER</Text><Text style={s.factValue}>{selectedPerson.staffNumber||selectedPerson.admissionNumber||selectedPerson.studentNumber||"—"}</Text></View>
          <View style={s.fact}><Text style={s.factLabel}>CLASS / DEPARTMENT</Text><Text style={s.factValue}>{selectedPerson.groupName||"—"}</Text></View>
        </View>
        <TouchableOpacity style={s.confirm} onPress={()=>void record(selectedPerson)} activeOpacity={.85}>
          <Text style={s.confirmText}>{direction==="IN"?"Confirm arrival":"Confirm departure"}</Text>
          <Text style={s.confirmArrow}>→</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.notMe} onPress={()=>{setSelectedPerson(null);setQuery("")}}><Text style={s.notMeText}>This is not me</Text></TouchableOpacity>
      </View>:null}
    </View>

    <View style={s.footer}>
      <Text style={s.footerText}>Name-only attendance · {online?"Synced with Ledgerly":"Saved safely offline"}</Text>
      {failedCount?<Text style={s.footerWarning}>{failedCount} rejected item{failedCount===1?"":"s"} need attention</Text>:null}
    </View>

    {error?<View style={s.errorBanner}><Text style={s.errorTitle}>Couldn’t complete that</Text><Text style={s.errorText}>{error}</Text></View>:null}

    {result?<View style={s.successOverlay}>
      <View style={s.successCard}>
        <View style={s.successCheck}><Text style={s.successCheckText}>✓</Text></View>
        <Text style={s.successHello}>{result.direction==="IN"?"Welcome":"Goodbye"}</Text>
        <Text style={s.successName}>{result.person.name}</Text>
        <Text style={s.successGroup}>{result.person.groupName||"School member"}</Text>
        <View style={s.successPill}><Text style={s.successPillText}>{result.direction==="IN"?"ARRIVAL RECORDED":"DEPARTURE RECORDED"}</Text></View>
        <Text style={s.successTime}>{new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</Text>
      </View>
    </View>:null}

    {exitOpen?<View style={s.modalShade}>
      <View style={s.exitCard}>
        <Text style={s.exitTitle}>Administrator settings</Text>
        <Text style={s.exitHelp}>Enter the kiosk exit PIN to change device settings.</Text>
        <TextInput style={s.exitInput} secureTextEntry keyboardType="number-pad" value={exitPin} onChangeText={setExitPin} placeholder="Exit PIN" placeholderTextColor="#87958e"/>
        <View style={s.exitActions}>
          <TouchableOpacity onPress={()=>{setExitOpen(false);setExitPin("")}}><Text style={s.cancel}>Cancel</Text></TouchableOpacity>
          <TouchableOpacity onPress={()=>void exit()}><Text style={s.exitConfirm}>Device settings</Text></TouchableOpacity>
          <TouchableOpacity onPress={async()=>{await DeviceManager.clearRegistration();onReset()}}><Text style={s.reset}>Reset kiosk</Text></TouchableOpacity>
        </View>
      </View>
    </View>:null}
  </SafeAreaView>;
}

const s=StyleSheet.create({
  root:{flex:1,backgroundColor:"#061a14"},
  header:{paddingHorizontal:22,paddingTop:10,paddingBottom:12,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  brand:{fontSize:27,fontWeight:"900",color:"#f6fffb",letterSpacing:-1},brandSub:{fontSize:9,fontWeight:"900",color:"#56d49a",letterSpacing:2.2,marginTop:1},
  headerRight:{alignItems:"flex-end",maxWidth:"58%"},location:{color:"#f0fff8",fontSize:14,fontWeight:"800",textAlign:"right"},statusLine:{flexDirection:"row",alignItems:"center",marginTop:4},statusDot:{width:7,height:7,borderRadius:4,marginRight:6},statusOnline:{backgroundColor:"#50e39b"},statusOffline:{backgroundColor:"#f5ad42"},statusText:{color:"#91b7a6",fontSize:10,fontWeight:"700"},
  hero:{marginHorizontal:16,borderRadius:24,backgroundColor:"#0c2a20",padding:20,borderWidth:1,borderColor:"#173f31"},heroCopy:{maxWidth:"92%"},eyebrow:{color:"#58dc9d",fontSize:10,fontWeight:"900",letterSpacing:1.8},heroTitle:{color:"white",fontSize:31,fontWeight:"900",letterSpacing:-1.2,marginTop:5},heroText:{color:"#9bbbad",fontSize:13,lineHeight:19,marginTop:6},summaryRow:{flexDirection:"row",gap:9,marginTop:18},summaryCard:{flex:1,borderRadius:16,backgroundColor:"#10372a",paddingVertical:12,paddingHorizontal:13},summaryValue:{color:"white",fontSize:22,fontWeight:"900"},summaryLabel:{color:"#86ad9b",fontSize:9,fontWeight:"800",textTransform:"uppercase",letterSpacing:.8,marginTop:2},
  directionWrap:{paddingHorizontal:16,marginTop:14},sectionLabel:{color:"#719888",fontSize:9,fontWeight:"900",letterSpacing:1.4,marginBottom:7,marginLeft:3},segment:{flexDirection:"row",gap:10},segmentButton:{flex:1,minHeight:62,borderRadius:18,borderWidth:1,borderColor:"#24483a",backgroundColor:"#0b241c",paddingHorizontal:14,flexDirection:"row",alignItems:"center",gap:10},segmentActive:{backgroundColor:"#e9fff4",borderColor:"#e9fff4"},segmentIcon:{color:"#76a18e",fontSize:25,fontWeight:"400"},segmentTextActive:{color:"#0c3a27"},segmentTitle:{color:"#e4f5ed",fontSize:15,fontWeight:"900"},segmentHint:{color:"#6f9785",fontSize:10,marginTop:1},segmentHintActive:{color:"#56806d"},
  searchCard:{flex:1,marginHorizontal:16,marginTop:14,borderRadius:24,backgroundColor:"#f6faf8",padding:18},searchTitle:{fontSize:21,fontWeight:"900",color:"#11261d"},searchHelp:{color:"#667a70",fontSize:12,lineHeight:17,marginTop:3,marginBottom:12},searchBox:{height:54,borderRadius:16,backgroundColor:"white",borderWidth:1,borderColor:"#d8e5de",flexDirection:"row",alignItems:"center",paddingHorizontal:14},searchGlyph:{fontSize:23,color:"#4a7762",marginRight:8},searchInput:{flex:1,color:"#13271e",fontSize:17,fontWeight:"700",paddingVertical:0},clear:{fontSize:28,color:"#83958c",paddingHorizontal:4},
  results:{marginTop:10,borderRadius:16,backgroundColor:"white",borderWidth:1,borderColor:"#dde8e2",overflow:"hidden",maxHeight:330},resultRow:{minHeight:58,paddingHorizontal:12,paddingVertical:9,flexDirection:"row",alignItems:"center",borderBottomWidth:1,borderBottomColor:"#edf3f0"},smallAvatar:{width:38,height:38,borderRadius:12,backgroundColor:"#daf3e7",alignItems:"center",justifyContent:"center",marginRight:10},smallAvatarText:{color:"#176943",fontSize:12,fontWeight:"900"},resultCopy:{flex:1},resultName:{color:"#142820",fontSize:15,fontWeight:"900"},resultMeta:{color:"#75867e",fontSize:10,marginTop:2},chevron:{color:"#78a18d",fontSize:25,fontWeight:"500"},empty:{padding:20,alignItems:"center"},emptyTitle:{color:"#273a32",fontWeight:"900"},emptyText:{color:"#84938c",fontSize:11,textAlign:"center",marginTop:4,lineHeight:16},
  personCard:{marginTop:12,alignItems:"center",backgroundColor:"white",borderRadius:18,borderWidth:1,borderColor:"#dce7e1",padding:16},avatar:{width:58,height:58,borderRadius:18,backgroundColor:"#158858",alignItems:"center",justifyContent:"center"},avatarText:{color:"white",fontSize:20,fontWeight:"900"},personName:{color:"#10271d",fontSize:22,fontWeight:"900",marginTop:9,textAlign:"center"},personType:{color:"#19885a",fontSize:9,fontWeight:"900",letterSpacing:1.2,marginTop:2},personFacts:{width:"100%",flexDirection:"row",gap:9,marginTop:13},fact:{flex:1,borderRadius:12,backgroundColor:"#f4f8f6",padding:10},factLabel:{color:"#84968d",fontSize:8,fontWeight:"900",letterSpacing:.8},factValue:{color:"#1c3027",fontSize:12,fontWeight:"800",marginTop:3},confirm:{width:"100%",height:51,borderRadius:15,backgroundColor:"#128454",marginTop:12,paddingHorizontal:17,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},confirmText:{color:"white",fontSize:16,fontWeight:"900"},confirmArrow:{color:"white",fontSize:22},notMe:{paddingTop:11,paddingHorizontal:15},notMeText:{color:"#71847a",fontSize:11,fontWeight:"700"},
  footer:{paddingHorizontal:20,paddingVertical:10,alignItems:"center"},footerText:{color:"#799e8e",fontSize:10,fontWeight:"700"},footerWarning:{color:"#f3bd61",fontSize:10,fontWeight:"800",marginTop:2},
  errorBanner:{position:"absolute",left:18,right:18,bottom:22,backgroundColor:"#4f1e23",borderRadius:16,padding:14,borderWidth:1,borderColor:"#843941",elevation:10},errorTitle:{color:"#ffdfe1",fontWeight:"900"},errorText:{color:"#eab9bd",fontSize:11,marginTop:2,lineHeight:16},
  successOverlay:{position:"absolute",left:0,right:0,top:0,bottom:0,backgroundColor:"rgba(3,16,12,.88)",alignItems:"center",justifyContent:"center",padding:24},successCard:{width:"100%",maxWidth:420,backgroundColor:"#f8fffb",borderRadius:30,padding:28,alignItems:"center",elevation:18},successCheck:{width:76,height:76,borderRadius:24,backgroundColor:"#19a96c",alignItems:"center",justifyContent:"center"},successCheckText:{color:"white",fontSize:44,fontWeight:"900"},successHello:{color:"#49816a",fontSize:13,fontWeight:"900",letterSpacing:1.2,textTransform:"uppercase",marginTop:19},successName:{color:"#10271e",fontSize:29,fontWeight:"900",letterSpacing:-1,textAlign:"center",marginTop:4},successGroup:{color:"#73857c",marginTop:4},successPill:{backgroundColor:"#ddf7ea",borderRadius:999,paddingHorizontal:15,paddingVertical:8,marginTop:17},successPillText:{color:"#157b50",fontSize:10,fontWeight:"900",letterSpacing:.8},successTime:{color:"#8b9b94",fontSize:12,fontWeight:"700",marginTop:10},
  modalShade:{position:"absolute",left:0,right:0,top:0,bottom:0,backgroundColor:"rgba(2,12,9,.78)",alignItems:"center",justifyContent:"center",padding:22},exitCard:{width:"100%",maxWidth:430,backgroundColor:"white",borderRadius:22,padding:20,elevation:15},exitTitle:{fontSize:21,fontWeight:"900",color:"#17281f"},exitHelp:{fontSize:12,color:"#718079",marginTop:4,marginBottom:14},exitInput:{borderWidth:1,borderColor:"#d5e1db",borderRadius:13,padding:13,color:"#17281f",fontSize:17},exitActions:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginTop:18},cancel:{color:"#718079",fontWeight:"800"},exitConfirm:{color:"#148356",fontWeight:"900"},reset:{color:"#b4232c",fontWeight:"900"}
});
