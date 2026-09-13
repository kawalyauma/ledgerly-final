import {useState} from "react";
import {SafeAreaView,ScrollView,StatusBar,StyleSheet,Text,TouchableOpacity,View} from "react-native";
import type {MobileSession} from "../auth";
import type {SessionUpdater} from "../apiClient";
import {OverviewTab} from "./OverviewTab";
import {PrintTab} from "./PrintTab";
import {ReceiptsTab} from "./ReceiptsTab";
import {ScannerlyTab} from "./ScannerlyTab";
import {RulesTab} from "./RulesTab";
import {BatchesTab} from "./BatchesTab";
import {ReportsTab} from "./ReportsTab";
import {AuditTab} from "./AuditTab";
import {RoutingTab} from "./RoutingTab";
import {ReleaseTab} from "./ReleaseTab";
import {PrivacyTab} from "./PrivacyTab";
import {SuppliesTab} from "./SuppliesTab";
import {ProcurementTab} from "./ProcurementTab";
import {AdminTab} from "./AdminTab";

type Tab="overview"|"print"|"receipts"|"scannerly"|"rules"|"batches"|"reports"|"audit"|"routing"|"release"|"privacy"|"supplies"|"procurement"|"admin";
const TABS:[Tab,string][]=[["overview","Overview"],["print","Print"],["receipts","Receipts"],["scannerly","Scannerly"],["rules","Rules"],["batches","Batches"],["reports","Reports"],["audit","Audit"],["routing","Routing"],["release","Release"],["privacy","Privacy"],["supplies","Supplies"],["procurement","Procurement"],["admin","Admin"]];
const HINTS:Record<Tab,string>={overview:"Printer service activity",print:"Create print jobs",receipts:"Automatic receipt printing",scannerly:"Scan documents",rules:"Print policies",batches:"Batch operations",reports:"Usage & costing",audit:"Activity trail",routing:"Printer routing",release:"Secure release",privacy:"Document privacy",supplies:"Consumables & stock",procurement:"Purchasing workflow",admin:"Printerly administration"};

export function PrinterlyWorkspaceScreen({session,onSession,onBack}:{session:MobileSession;onSession:SessionUpdater;onBack:()=>void}){
  const[tab,setTab]=useState<Tab>("overview");
  const label=TABS.find(([id])=>id===tab)?.[1]??"Overview";
  const content=tab==="overview"?<OverviewTab session={session} onSession={onSession}/>:tab==="print"?<PrintTab session={session} onSession={onSession}/>:tab==="receipts"?<ReceiptsTab session={session} onSession={onSession}/>:tab==="scannerly"?<ScannerlyTab session={session} onSession={onSession}/>:tab==="rules"?<RulesTab session={session} onSession={onSession}/>:tab==="batches"?<BatchesTab session={session} onSession={onSession}/>:tab==="reports"?<ReportsTab session={session} onSession={onSession}/>:tab==="audit"?<AuditTab session={session} onSession={onSession}/>:tab==="routing"?<RoutingTab session={session} onSession={onSession}/>:tab==="release"?<ReleaseTab session={session} onSession={onSession}/>:tab==="privacy"?<PrivacyTab session={session} onSession={onSession}/>:tab==="supplies"?<SuppliesTab session={session} onSession={onSession}/>:tab==="procurement"?<ProcurementTab session={session} onSession={onSession}/>:<AdminTab session={session} onSession={onSession}/>;
  return <SafeAreaView style={s.root}>
    <StatusBar barStyle="light-content" backgroundColor="#2a302d"/>
    <View style={s.header}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={s.back}><Text style={s.backText}>←</Text></TouchableOpacity>
      <View style={s.headerCopy}><Text style={s.eyebrow}>PRINTERLY · v1.15</Text><Text style={s.title}>{label}</Text><Text style={s.sub}>{HINTS[tab]}</Text></View>
      <View style={s.badge}><Text style={s.badgeText}>NODE</Text></View>
    </View>
    <View style={s.tabsShell}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>{TABS.map(([id,itemLabel])=><TouchableOpacity accessibilityRole="tab" accessibilityState={{selected:tab===id}} key={id} onPress={()=>setTab(id)} style={[s.tab,tab===id&&s.tabOn]}><Text style={[s.tabText,tab===id&&s.tabTextOn]}>{itemLabel}</Text></TouchableOpacity>)}</ScrollView></View>
    <View style={s.body}>{content}</View>
  </SafeAreaView>;
}

const s=StyleSheet.create({
  root:{flex:1,backgroundColor:"#f5f5f3"},
  header:{minHeight:92,backgroundColor:"#2a302d",paddingHorizontal:16,paddingVertical:12,flexDirection:"row",alignItems:"center"},
  back:{width:48,height:48,borderRadius:15,backgroundColor:"#414b46",alignItems:"center",justifyContent:"center",marginRight:12},
  backText:{fontSize:24,color:"white",fontWeight:"800"},
  headerCopy:{flex:1,minWidth:0},
  eyebrow:{fontSize:11,fontWeight:"900",letterSpacing:1,color:"#ddc57f"},
  title:{fontSize:22,fontWeight:"900",color:"white",marginTop:2},
  sub:{fontSize:12,color:"#bdc6c1",marginTop:2},
  badge:{backgroundColor:"#574b31",borderRadius:16,paddingHorizontal:11,paddingVertical:9,marginLeft:8},
  badgeText:{fontSize:10,fontWeight:"900",color:"#f0d794",letterSpacing:.7},
  tabsShell:{backgroundColor:"#f5f5f3",borderBottomWidth:1,borderBottomColor:"#dfe3e0"},
  tabs:{paddingHorizontal:12,paddingVertical:10,gap:8},
  tab:{minHeight:46,paddingHorizontal:16,paddingVertical:11,borderRadius:18,backgroundColor:"#e8ebe9",justifyContent:"center"},
  tabOn:{backgroundColor:"#4a4030"},
  tabText:{fontSize:12,fontWeight:"900",color:"#58675f"},
  tabTextOn:{color:"white"},
  body:{flex:1},
});
