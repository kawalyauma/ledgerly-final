import {useState} from "react";
import {SafeAreaView,ScrollView,StatusBar,StyleSheet,Text,TouchableOpacity,View} from "react-native";
import type {MobileSession} from "../auth";
import type {SessionUpdater} from "../apiClient";
import {OverviewTab} from "./OverviewTab";
import {WorkforceTab} from "./WorkforceTab";
import {LeaveTab} from "./LeaveTab";
import {OnboardingTab} from "./OnboardingTab";
import {SetupTab} from "./SetupTab";

type Tab="overview"|"workforce"|"leave"|"onboarding"|"setup";
const tabs:{id:Tab;label:string;icon:string;hint:string}[]=[
  {id:"overview",label:"Overview",icon:"⌂",hint:"People operations"},
  {id:"workforce",label:"Workforce",icon:"W",hint:"Staff records"},
  {id:"leave",label:"Leave",icon:"L",hint:"Requests & balances"},
  {id:"onboarding",label:"Onboard",icon:"✓",hint:"New staff setup"},
  {id:"setup",label:"Setup",icon:"⚙",hint:"HR configuration"},
];

export function HumanResourcesWorkspaceScreen({session,onSession,onBack}:{session:MobileSession;onSession:SessionUpdater;onBack:()=>void}){
  const[tab,setTab]=useState<Tab>("overview");
  const active=tabs.find(x=>x.id===tab)??tabs[0];
  const content=tab==="overview"?<OverviewTab session={session} onSession={onSession}/>:tab==="workforce"?<WorkforceTab session={session} onSession={onSession}/>:tab==="leave"?<LeaveTab session={session} onSession={onSession}/>:tab==="onboarding"?<OnboardingTab session={session} onSession={onSession}/>:<SetupTab session={session} onSession={onSession}/>;
  return <SafeAreaView style={s.root}>
    <StatusBar barStyle="light-content" backgroundColor="#30283f"/>
    <View style={s.head}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" style={s.back} onPress={onBack}><Text style={s.backText}>←</Text></TouchableOpacity>
      <View style={s.headerCopy}><Text style={s.eyebrow}>HUMAN RESOURCES</Text><Text style={s.title}>{active.label}</Text><Text style={s.hint}>{active.hint}</Text></View>
      <View style={s.badge}><Text style={s.badgeText}>PEOPLE</Text></View>
    </View>
    <View style={s.body}>{content}</View>
    <View style={s.navShell}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.nav}>
      {tabs.map(x=><TouchableOpacity accessibilityRole="tab" accessibilityState={{selected:tab===x.id}} key={x.id} onPress={()=>setTab(x.id)} style={[s.navItem,tab===x.id&&s.navItemActive]}><View style={[s.navIcon,tab===x.id&&s.navIconOn]}><Text style={[s.navGlyph,tab===x.id&&s.navGlyphOn]}>{x.icon}</Text></View><Text style={[s.navText,tab===x.id&&s.navTextOn]}>{x.label}</Text></TouchableOpacity>)}
    </ScrollView></View>
  </SafeAreaView>;
}

const s=StyleSheet.create({
  root:{flex:1,backgroundColor:"#f5f4f7"},
  head:{minHeight:92,backgroundColor:"#30283f",flexDirection:"row",alignItems:"center",paddingHorizontal:14,paddingVertical:12},
  back:{width:48,height:48,borderRadius:15,backgroundColor:"#493d5f",alignItems:"center",justifyContent:"center",marginRight:12},
  backText:{fontSize:24,fontWeight:"700",color:"white"},
  headerCopy:{flex:1,minWidth:0},
  eyebrow:{fontSize:11,fontWeight:"900",letterSpacing:1.05,color:"#cbb7ef"},
  title:{fontSize:22,fontWeight:"900",color:"white",marginTop:2},
  hint:{fontSize:12,color:"#c5b9d8",marginTop:2},
  badge:{marginLeft:8,borderRadius:16,backgroundColor:"#eee7fb",paddingHorizontal:10,paddingVertical:9},
  badgeText:{fontSize:10,fontWeight:"900",color:"#644f88"},
  body:{flex:1},
  navShell:{backgroundColor:"white",borderTopWidth:1,borderTopColor:"#e4e0e9"},
  nav:{paddingHorizontal:8,paddingVertical:8,gap:6},
  navItem:{width:94,minHeight:62,borderRadius:16,alignItems:"center",justifyContent:"center",paddingHorizontal:6},
  navItemActive:{backgroundColor:"#f7f3fc"},
  navIcon:{width:34,height:30,borderRadius:10,alignItems:"center",justifyContent:"center"},
  navIconOn:{backgroundColor:"#eee9f7"},
  navGlyph:{fontSize:15,fontWeight:"900",color:"#7e7885"},
  navGlyphOn:{color:"#66508e"},
  navText:{fontSize:11,fontWeight:"800",color:"#716b78",marginTop:3},
  navTextOn:{color:"#66508e"},
});
