import {useState} from "react";
import {SafeAreaView,ScrollView,StatusBar,StyleSheet,Text,TouchableOpacity,View} from "react-native";
import type {MobileSession} from "../auth";
import type {SessionUpdater} from "../apiClient";
import {OverviewTab} from "./OverviewTab";
import {ComposeTab} from "./ComposeTab";
import {CampaignsTab} from "./CampaignsTab";
import {DeliveriesTab} from "./DeliveriesTab";
import {SetupTab} from "./SetupTab";

type Tab="overview"|"compose"|"campaigns"|"deliveries"|"setup";
const tabs:{id:Tab;label:string;icon:string;hint:string}[]=[
  {id:"overview",label:"Overview",icon:"⌂",hint:"Communication activity"},
  {id:"compose",label:"Compose",icon:"+",hint:"Create a message"},
  {id:"campaigns",label:"Campaigns",icon:"C",hint:"Bulk communication"},
  {id:"deliveries",label:"Delivery",icon:"D",hint:"Delivery tracking"},
  {id:"setup",label:"Setup",icon:"⚙",hint:"Channels & templates"},
];

export function CommunicationsWorkspaceScreen({session,onSession,onBack}:{session:MobileSession;onSession:SessionUpdater;onBack:()=>void}){
  const[tab,setTab]=useState<Tab>("overview");
  const active=tabs.find(x=>x.id===tab)??tabs[0];
  const content=tab==="overview"?<OverviewTab session={session} onSession={onSession}/>:tab==="compose"?<ComposeTab session={session} onSession={onSession}/>:tab==="campaigns"?<CampaignsTab session={session} onSession={onSession}/>:tab==="deliveries"?<DeliveriesTab session={session} onSession={onSession}/>:<SetupTab session={session} onSession={onSession}/>;
  return <SafeAreaView style={s.root}>
    <StatusBar barStyle="light-content" backgroundColor="#382951"/>
    <View style={s.head}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" style={s.back} onPress={onBack}><Text style={s.backText}>←</Text></TouchableOpacity>
      <View style={s.headerCopy}><Text style={s.eyebrow}>MESSAGES & NOTIFICATIONS</Text><Text style={s.title}>{active.label}</Text><Text style={s.hint}>{active.hint}</Text></View>
      <View style={s.badge}><Text style={s.badgeText}>COMMS</Text></View>
    </View>
    <View style={s.body}>{content}</View>
    <View style={s.navShell}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.nav}>
      {tabs.map(x=><TouchableOpacity accessibilityRole="tab" accessibilityState={{selected:tab===x.id}} key={x.id} onPress={()=>setTab(x.id)} style={[s.navItem,tab===x.id&&s.navItemActive]}><View style={[s.navIcon,tab===x.id&&s.navIconOn]}><Text style={[s.navGlyph,tab===x.id&&s.navGlyphOn]}>{x.icon}</Text></View><Text style={[s.navText,tab===x.id&&s.navTextOn]}>{x.label}</Text></TouchableOpacity>)}
    </ScrollView></View>
  </SafeAreaView>;
}

const s=StyleSheet.create({
  root:{flex:1,backgroundColor:"#f5f3f7"},
  head:{minHeight:92,backgroundColor:"#382951",flexDirection:"row",alignItems:"center",paddingHorizontal:14,paddingVertical:12},
  back:{width:48,height:48,borderRadius:15,backgroundColor:"#52406e",alignItems:"center",justifyContent:"center",marginRight:12},
  backText:{fontSize:24,fontWeight:"700",color:"white"},
  headerCopy:{flex:1,minWidth:0},
  eyebrow:{fontSize:10.5,fontWeight:"900",letterSpacing:.9,color:"#d2b8f5"},
  title:{fontSize:22,fontWeight:"900",color:"white",marginTop:2},
  hint:{fontSize:12,color:"#c8bad8",marginTop:2},
  badge:{marginLeft:8,borderRadius:16,backgroundColor:"#eee7f7",paddingHorizontal:10,paddingVertical:9},
  badgeText:{fontSize:10,fontWeight:"900",color:"#6a518c"},
  body:{flex:1},
  navShell:{backgroundColor:"white",borderTopWidth:1,borderTopColor:"#e5e0ea"},
  nav:{paddingHorizontal:8,paddingVertical:8,gap:6},
  navItem:{width:98,minHeight:62,borderRadius:16,alignItems:"center",justifyContent:"center",paddingHorizontal:6},
  navItemActive:{backgroundColor:"#f7f3fb"},
  navIcon:{width:34,height:30,borderRadius:10,alignItems:"center",justifyContent:"center"},
  navIconOn:{backgroundColor:"#eee8f5"},
  navGlyph:{fontSize:15,fontWeight:"900",color:"#7f7887"},
  navGlyphOn:{color:"#705595"},
  navText:{fontSize:11,fontWeight:"800",color:"#736b7c",marginTop:3},
  navTextOn:{color:"#705595"},
});
