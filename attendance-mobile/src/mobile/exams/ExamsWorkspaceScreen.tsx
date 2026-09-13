import {useState} from "react";
import {SafeAreaView,ScrollView,StatusBar,StyleSheet,Text,TouchableOpacity,View} from "react-native";
import type {MobileSession} from "../auth";
import type {SessionUpdater} from "../apiClient";
import {OverviewTab} from "./OverviewTab";
import {ExamsTab} from "./ExamsTab";
import {MarksTab} from "./MarksTab";
import {ReportsTab} from "./ReportsTab";
import {SetupTab} from "./SetupTab";

type Tab="overview"|"exams"|"marks"|"reports"|"setup";
const tabs:{id:Tab;label:string;icon:string;hint:string}[]=[
  {id:"overview",label:"Overview",icon:"⌂",hint:"Exam activity"},
  {id:"exams",label:"Exams",icon:"E",hint:"Sessions & papers"},
  {id:"marks",label:"Marks",icon:"✓",hint:"Capture & review"},
  {id:"reports",label:"Reports",icon:"R",hint:"Results & reports"},
  {id:"setup",label:"Setup",icon:"⚙",hint:"Exam configuration"},
];

export function ExamsWorkspaceScreen({session,onSession,onBack}:{session:MobileSession;onSession:SessionUpdater;onBack:()=>void}){
  const[tab,setTab]=useState<Tab>("overview");
  const active=tabs.find(x=>x.id===tab)??tabs[0];
  const content=tab==="overview"?<OverviewTab session={session} onSession={onSession}/>:tab==="exams"?<ExamsTab session={session} onSession={onSession}/>:tab==="marks"?<MarksTab session={session} onSession={onSession}/>:tab==="reports"?<ReportsTab session={session} onSession={onSession}/>:<SetupTab session={session} onSession={onSession}/>;
  return <SafeAreaView style={s.root}>
    <StatusBar barStyle="light-content" backgroundColor="#102b42"/>
    <View style={s.head}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" style={s.back} onPress={onBack}><Text style={s.backText}>←</Text></TouchableOpacity>
      <View style={s.headerCopy}><Text style={s.eyebrow}>EXAMINATIONS</Text><Text style={s.title}>{active.label}</Text><Text style={s.hint}>{active.hint}</Text></View>
      <View style={s.badge}><Text style={s.badgeText}>PLE</Text></View>
    </View>
    <View style={s.body}>{content}</View>
    <View style={s.navShell}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.nav}>
      {tabs.map(x=><TouchableOpacity accessibilityRole="tab" accessibilityState={{selected:tab===x.id}} key={x.id} onPress={()=>setTab(x.id)} style={[s.navItem,tab===x.id&&s.navItemActive]}><View style={[s.navIcon,tab===x.id&&s.navIconOn]}><Text style={[s.navGlyph,tab===x.id&&s.navGlyphOn]}>{x.icon}</Text></View><Text style={[s.navText,tab===x.id&&s.navTextOn]}>{x.label}</Text></TouchableOpacity>)}
    </ScrollView></View>
  </SafeAreaView>;
}

const s=StyleSheet.create({
  root:{flex:1,backgroundColor:"#f4f7f5"},
  head:{minHeight:92,backgroundColor:"#102b42",flexDirection:"row",alignItems:"center",paddingHorizontal:14,paddingVertical:12},
  back:{width:48,height:48,borderRadius:15,backgroundColor:"#1d435f",alignItems:"center",justifyContent:"center",marginRight:12},
  backText:{fontSize:24,fontWeight:"700",color:"white"},
  headerCopy:{flex:1,minWidth:0},
  eyebrow:{fontSize:11,fontWeight:"900",letterSpacing:1.1,color:"#8bc7e8"},
  title:{fontSize:22,fontWeight:"900",color:"white",marginTop:2},
  hint:{fontSize:12,color:"#acd0e4",marginTop:2},
  badge:{marginLeft:8,borderRadius:16,backgroundColor:"#dceefa",paddingHorizontal:12,paddingVertical:9},
  badgeText:{fontSize:11,fontWeight:"900",color:"#1c6e99"},
  body:{flex:1},
  navShell:{backgroundColor:"white",borderTopWidth:1,borderTopColor:"#dde6e2"},
  nav:{paddingHorizontal:8,paddingVertical:8,gap:6},
  navItem:{width:92,minHeight:62,borderRadius:16,alignItems:"center",justifyContent:"center",paddingHorizontal:6},
  navItemActive:{backgroundColor:"#f1f8fb"},
  navIcon:{width:34,height:30,borderRadius:10,alignItems:"center",justifyContent:"center"},
  navIconOn:{backgroundColor:"#e4f1f7"},
  navGlyph:{fontSize:15,fontWeight:"900",color:"#71817a"},
  navGlyphOn:{color:"#2178a5"},
  navText:{fontSize:11,fontWeight:"800",color:"#687972",marginTop:3},
  navTextOn:{color:"#2178a5"},
});
