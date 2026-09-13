import {useState} from "react";
import {SafeAreaView,ScrollView,StatusBar,StyleSheet,Text,TouchableOpacity,View} from "react-native";
import type {MobileSession} from "../auth";
import type {SessionUpdater} from "../apiClient";
import {OverviewTab} from "./OverviewTab";
import {PayrollTab} from "./PayrollTab";
import {InputsTab} from "./InputsTab";
import {PaymentsTab} from "./PaymentsTab";
import {SetupTab} from "./SetupTab";

type Tab="overview"|"payroll"|"inputs"|"payments"|"setup";
const tabs:{id:Tab;label:string;icon:string;hint:string}[]=[
  {id:"overview",label:"Overview",icon:"⌂",hint:"Payroll activity"},
  {id:"payroll",label:"Payroll",icon:"P",hint:"Runs & payslips"},
  {id:"inputs",label:"Inputs",icon:"I",hint:"Earnings & deductions"},
  {id:"payments",label:"Payments",icon:"$",hint:"Disbursements"},
  {id:"setup",label:"Setup",icon:"⚙",hint:"Payroll configuration"},
];

export function PayrollPaymentsWorkspaceScreen({session,onSession,onBack}:{session:MobileSession;onSession:SessionUpdater;onBack:()=>void}){
  const[tab,setTab]=useState<Tab>("overview");
  const active=tabs.find(x=>x.id===tab)??tabs[0];
  const content=tab==="overview"?<OverviewTab session={session} onSession={onSession}/>:tab==="payroll"?<PayrollTab session={session} onSession={onSession}/>:tab==="inputs"?<InputsTab session={session} onSession={onSession}/>:tab==="payments"?<PaymentsTab session={session} onSession={onSession}/>:<SetupTab session={session} onSession={onSession}/>;
  return <SafeAreaView style={s.root}>
    <StatusBar barStyle="light-content" backgroundColor="#132f2a"/>
    <View style={s.head}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" style={s.back} onPress={onBack}><Text style={s.backText}>←</Text></TouchableOpacity>
      <View style={s.headerCopy}><Text style={s.eyebrow}>PAYROLL & PAYMENTS</Text><Text style={s.title}>{active.label}</Text><Text style={s.hint}>{active.hint}</Text></View>
      <View style={s.badge}><Text style={s.badgeText}>FINANCE</Text></View>
    </View>
    <View style={s.body}>{content}</View>
    <View style={s.navShell}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.nav}>
      {tabs.map(x=><TouchableOpacity accessibilityRole="tab" accessibilityState={{selected:tab===x.id}} key={x.id} onPress={()=>setTab(x.id)} style={[s.navItem,tab===x.id&&s.navItemActive]}><View style={[s.navIcon,tab===x.id&&s.navIconOn]}><Text style={[s.navGlyph,tab===x.id&&s.navGlyphOn]}>{x.icon}</Text></View><Text style={[s.navText,tab===x.id&&s.navTextOn]}>{x.label}</Text></TouchableOpacity>)}
    </ScrollView></View>
  </SafeAreaView>;
}

const s=StyleSheet.create({
  root:{flex:1,backgroundColor:"#f4f7f5"},
  head:{minHeight:92,backgroundColor:"#132f2a",flexDirection:"row",alignItems:"center",paddingHorizontal:14,paddingVertical:12},
  back:{width:48,height:48,borderRadius:15,backgroundColor:"#214b42",alignItems:"center",justifyContent:"center",marginRight:12},
  backText:{fontSize:24,fontWeight:"700",color:"white"},
  headerCopy:{flex:1,minWidth:0},
  eyebrow:{fontSize:11,fontWeight:"900",letterSpacing:1.05,color:"#77ddb5"},
  title:{fontSize:22,fontWeight:"900",color:"white",marginTop:2},
  hint:{fontSize:12,color:"#a8c9bc",marginTop:2},
  badge:{marginLeft:8,borderRadius:16,backgroundColor:"#ddf5e9",paddingHorizontal:10,paddingVertical:9},
  badgeText:{fontSize:10,fontWeight:"900",color:"#16764f"},
  body:{flex:1},
  navShell:{backgroundColor:"white",borderTopWidth:1,borderTopColor:"#dce7e1"},
  nav:{paddingHorizontal:8,paddingVertical:8,gap:6},
  navItem:{width:96,minHeight:62,borderRadius:16,alignItems:"center",justifyContent:"center",paddingHorizontal:6},
  navItemActive:{backgroundColor:"#f1faf5"},
  navIcon:{width:34,height:30,borderRadius:10,alignItems:"center",justifyContent:"center"},
  navIconOn:{backgroundColor:"#e5f5ed"},
  navGlyph:{fontSize:15,fontWeight:"900",color:"#72817a"},
  navGlyphOn:{color:"#157a52"},
  navText:{fontSize:11,fontWeight:"800",color:"#687770",marginTop:3},
  navTextOn:{color:"#157a52"},
});
