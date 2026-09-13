import {useState} from "react";
import {SafeAreaView,ScrollView,StatusBar,StyleSheet,Text,TouchableOpacity,View} from "react-native";
import type {MobileSession} from "../auth";
import type {SessionUpdater} from "../apiClient";
import {OverviewTab} from "./OverviewTab";
import {AccountingTab} from "./AccountingTab";
import {DocumentsTab} from "./DocumentsTab";
import {BankingTab} from "./BankingTab";
import {ControlsReportsTab} from "./ControlsReportsTab";

type Tab="overview"|"accounting"|"documents"|"banking"|"controls";
const TABS:{id:Tab;label:string;hint:string}[]=[
  {id:"overview",label:"Overview",hint:"Financial activity"},
  {id:"accounting",label:"Accounting",hint:"Journals & ledgers"},
  {id:"documents",label:"Documents",hint:"Invoices & records"},
  {id:"banking",label:"Banking",hint:"Accounts & reconciliation"},
  {id:"controls",label:"Controls",hint:"Reports & approvals"},
];

export function FinanceCoreWorkspaceScreen({session,onSession,onBack}:{session:MobileSession;onSession:SessionUpdater;onBack:()=>void}){
  const[tab,setTab]=useState<Tab>("overview");
  const active=TABS.find(x=>x.id===tab)??TABS[0];
  const content=tab==="overview"?<OverviewTab session={session} onSession={onSession}/>:tab==="accounting"?<AccountingTab session={session} onSession={onSession}/>:tab==="documents"?<DocumentsTab session={session} onSession={onSession}/>:tab==="banking"?<BankingTab session={session} onSession={onSession}/>:<ControlsReportsTab session={session} onSession={onSession}/>;
  return <SafeAreaView style={s.root}>
    <StatusBar barStyle="light-content" backgroundColor="#102c24"/>
    <View style={s.header}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={s.back}><Text style={s.backText}>←</Text></TouchableOpacity>
      <View style={s.headerCopy}><Text style={s.eyebrow}>FINANCE CORE</Text><Text style={s.title}>{active.label}</Text><Text style={s.sub}>{active.hint}</Text></View>
      <View style={s.badge}><View style={s.badgeDot}/><Text style={s.badgeText}>LIVE</Text></View>
    </View>
    <View style={s.tabsShell}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>{TABS.map(x=><TouchableOpacity accessibilityRole="tab" accessibilityState={{selected:tab===x.id}} key={x.id} onPress={()=>setTab(x.id)} style={[s.tab,tab===x.id&&s.tabOn]}><Text style={[s.tabText,tab===x.id&&s.tabTextOn]}>{x.label}</Text></TouchableOpacity>)}</ScrollView></View>
    <View style={s.body}>{content}</View>
  </SafeAreaView>;
}

const s=StyleSheet.create({
  root:{flex:1,backgroundColor:"#f4f6f5"},
  header:{minHeight:92,backgroundColor:"#102c24",paddingHorizontal:16,paddingVertical:12,flexDirection:"row",alignItems:"center"},
  back:{width:48,height:48,borderRadius:15,backgroundColor:"#1a4638",alignItems:"center",justifyContent:"center",marginRight:12},
  backText:{fontSize:24,color:"white",fontWeight:"800"},
  headerCopy:{flex:1,minWidth:0},
  eyebrow:{fontSize:11,fontWeight:"900",letterSpacing:1.05,color:"#8cdbb4"},
  title:{fontSize:22,fontWeight:"900",color:"white",marginTop:2},
  sub:{fontSize:12,color:"#afc9bd",marginTop:2},
  badge:{backgroundColor:"#1c5c47",borderRadius:18,paddingHorizontal:11,paddingVertical:8,flexDirection:"row",alignItems:"center",marginLeft:8},
  badgeDot:{width:7,height:7,borderRadius:4,backgroundColor:"#7ee0b4",marginRight:6},
  badgeText:{fontSize:10,fontWeight:"900",color:"#c7f6df",letterSpacing:.7},
  tabsShell:{backgroundColor:"#f4f6f5",borderBottomWidth:1,borderBottomColor:"#dce5e0"},
  tabs:{paddingHorizontal:12,paddingVertical:10,gap:8},
  tab:{minHeight:46,paddingHorizontal:16,paddingVertical:11,borderRadius:18,backgroundColor:"#e5ebe8",justifyContent:"center"},
  tabOn:{backgroundColor:"#173c30"},
  tabText:{fontSize:12,fontWeight:"900",color:"#526a5f"},
  tabTextOn:{color:"white"},
  body:{flex:1},
});
