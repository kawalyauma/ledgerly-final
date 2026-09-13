import {useState} from "react";
import {SafeAreaView,ScrollView,StatusBar,StyleSheet,Text,TouchableOpacity,View} from "react-native";
import type {MobileSession} from "../auth";
import type {SessionUpdater} from "../apiClient";
import {OverviewTab} from "./OverviewTab";
import {TimetableTab} from "./TimetableTab";
import {PlanningTab} from "./PlanningTab";
import {DeliveryTab} from "./DeliveryTab";
import {SupervisionTab} from "./SupervisionTab";

type Tab="overview"|"timetable"|"planning"|"delivery"|"supervision";
const tabs:{id:Tab;label:string;icon:string;hint:string}[]=[
  {id:"overview",label:"Overview",icon:"⌂",hint:"Academic pulse"},
  {id:"timetable",label:"Timetable",icon:"▦",hint:"Classes & periods"},
  {id:"planning",label:"Planning",icon:"≡",hint:"Schemes & lesson plans"},
  {id:"delivery",label:"Delivery",icon:"✓",hint:"Teaching progress"},
  {id:"supervision",label:"Supervise",icon:"◎",hint:"Quality & follow-up"},
];

export function AcademicsWorkspaceScreen({session,onSession,onBack}:{session:MobileSession;onSession:SessionUpdater;onBack:()=>void}){
  const[tab,setTab]=useState<Tab>("overview");
  const common={session,onSession};
  const active=tabs.find(x=>x.id===tab)??tabs[0];
  const content=tab==="overview"?<OverviewTab {...common}/>:tab==="timetable"?<TimetableTab {...common}/>:tab==="planning"?<PlanningTab {...common}/>:tab==="delivery"?<DeliveryTab {...common}/>:<SupervisionTab {...common}/>;
  return <SafeAreaView style={s.root}>
    <StatusBar barStyle="light-content" backgroundColor="#081c16"/>
    <View style={s.header}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" style={s.back} onPress={onBack}><Text style={s.backText}>←</Text></TouchableOpacity>
      <View style={s.headerCopy}><Text style={s.eyebrow}>ACADEMICS</Text><Text style={s.title}>{active.label}</Text><Text style={s.hint}>{active.hint}</Text></View>
      <View style={s.badge}><View style={s.badgeDot}/><Text style={s.badgeText}>LIVE</Text></View>
    </View>
    <View style={s.body}>{content}</View>
    <View style={s.navShell}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.nav}>
      {tabs.map(x=><TouchableOpacity accessibilityRole="tab" accessibilityState={{selected:tab===x.id}} key={x.id} style={[s.navItem,tab===x.id&&s.navItemActive]} onPress={()=>setTab(x.id)}><View style={[s.navIcon,tab===x.id&&s.navIconActive]}><Text style={[s.navIconText,tab===x.id&&s.navIconTextActive]}>{x.icon}</Text></View><Text style={[s.navText,tab===x.id&&s.navTextActive]}>{x.label}</Text></TouchableOpacity>)}
    </ScrollView></View>
  </SafeAreaView>;
}

const s=StyleSheet.create({
  root:{flex:1,backgroundColor:"#f3f6f4"},
  header:{minHeight:92,backgroundColor:"#081c16",paddingHorizontal:16,paddingVertical:12,flexDirection:"row",alignItems:"center"},
  back:{width:48,height:48,borderRadius:15,backgroundColor:"#14382d",alignItems:"center",justifyContent:"center",marginRight:12},
  backText:{color:"white",fontSize:24,fontWeight:"700"},
  headerCopy:{flex:1,minWidth:0},
  eyebrow:{color:"#8bb3a3",fontSize:11,fontWeight:"900",letterSpacing:1.1},
  title:{color:"white",fontSize:22,fontWeight:"900",marginTop:2},
  hint:{color:"#a7c3b7",fontSize:12,marginTop:2},
  badge:{borderRadius:18,backgroundColor:"#174735",paddingHorizontal:11,paddingVertical:8,flexDirection:"row",alignItems:"center",marginLeft:8},
  badgeDot:{width:7,height:7,borderRadius:4,backgroundColor:"#67d5a1",marginRight:6},
  badgeText:{fontSize:10,fontWeight:"900",color:"#8fe2b9",letterSpacing:.7},
  body:{flex:1},
  navShell:{backgroundColor:"white",borderTopWidth:1,borderTopColor:"#dfe7e2"},
  nav:{paddingHorizontal:8,paddingVertical:8,gap:6},
  navItem:{width:92,minHeight:62,borderRadius:16,alignItems:"center",justifyContent:"center",paddingHorizontal:6},
  navItemActive:{backgroundColor:"#f0faf5"},
  navIcon:{width:34,height:30,borderRadius:10,alignItems:"center",justifyContent:"center"},
  navIconActive:{backgroundColor:"#dff3e9"},
  navIconText:{fontSize:16,color:"#71847b",fontWeight:"900"},
  navIconTextActive:{color:"#148e5b"},
  navText:{fontSize:11,fontWeight:"800",color:"#65776e",marginTop:3},
  navTextActive:{color:"#148e5b"},
});
