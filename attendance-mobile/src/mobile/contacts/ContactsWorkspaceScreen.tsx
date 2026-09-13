import {useState} from "react";
import {SafeAreaView,ScrollView,StatusBar,StyleSheet,Text,TouchableOpacity,View} from "react-native";
import type {MobileSession} from "../auth";
import type {SessionUpdater} from "../apiClient";
import {OverviewTab} from "./OverviewTab";
import {DirectoryTab} from "./DirectoryTab";
import {ContactsTab} from "./ContactsTab";
import {ArchivedTab} from "./ArchivedTab";

type Tab="overview"|"directory"|"contacts"|"archive";
const tabs:{id:Tab;label:string;icon:string;hint:string}[]=[
  {id:"overview",label:"Overview",icon:"⌂",hint:"Directory activity"},
  {id:"directory",label:"Directory",icon:"D",hint:"People & organizations"},
  {id:"contacts",label:"Contacts",icon:"C",hint:"Contact records"},
  {id:"archive",label:"Archive",icon:"A",hint:"Archived contacts"},
];

export function ContactsWorkspaceScreen({session,onSession,onBack}:{session:MobileSession;onSession:SessionUpdater;onBack:()=>void}){
  const[tab,setTab]=useState<Tab>("overview");
  const active=tabs.find(x=>x.id===tab)??tabs[0];
  const content=tab==="overview"?<OverviewTab session={session} onSession={onSession}/>:tab==="directory"?<DirectoryTab session={session} onSession={onSession}/>:tab==="contacts"?<ContactsTab session={session} onSession={onSession}/>:<ArchivedTab session={session} onSession={onSession}/>;
  return <SafeAreaView style={s.root}>
    <StatusBar barStyle="light-content" backgroundColor="#173c46"/>
    <View style={s.head}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" style={s.back} onPress={onBack}><Text style={s.backText}>←</Text></TouchableOpacity>
      <View style={s.headerCopy}><Text style={s.eyebrow}>CONTACTS</Text><Text style={s.title}>{active.label}</Text><Text style={s.hint}>{active.hint}</Text></View>
      <View style={s.badge}><Text style={s.badgeText}>DIRECTORY</Text></View>
    </View>
    <View style={s.body}>{content}</View>
    <View style={s.navShell}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.nav}>
      {tabs.map(x=><TouchableOpacity accessibilityRole="tab" accessibilityState={{selected:tab===x.id}} key={x.id} onPress={()=>setTab(x.id)} style={[s.navItem,tab===x.id&&s.navItemActive]}><View style={[s.navIcon,tab===x.id&&s.navIconOn]}><Text style={[s.navGlyph,tab===x.id&&s.navGlyphOn]}>{x.icon}</Text></View><Text style={[s.navText,tab===x.id&&s.navTextOn]}>{x.label}</Text></TouchableOpacity>)}
    </ScrollView></View>
  </SafeAreaView>;
}

const s=StyleSheet.create({
  root:{flex:1,backgroundColor:"#f3f6f6"},
  head:{minHeight:92,backgroundColor:"#173c46",flexDirection:"row",alignItems:"center",paddingHorizontal:14,paddingVertical:12},
  back:{width:48,height:48,borderRadius:15,backgroundColor:"#285562",alignItems:"center",justifyContent:"center",marginRight:12},
  backText:{fontSize:24,fontWeight:"700",color:"white"},
  headerCopy:{flex:1,minWidth:0},
  eyebrow:{fontSize:11,fontWeight:"900",letterSpacing:1.05,color:"#91dce3"},
  title:{fontSize:22,fontWeight:"900",color:"white",marginTop:2},
  hint:{fontSize:12,color:"#b0ced2",marginTop:2},
  badge:{marginLeft:8,borderRadius:16,backgroundColor:"#dff4f5",paddingHorizontal:10,paddingVertical:9},
  badgeText:{fontSize:10,fontWeight:"900",color:"#23626d"},
  body:{flex:1},
  navShell:{backgroundColor:"white",borderTopWidth:1,borderTopColor:"#dce6e7"},
  nav:{paddingHorizontal:8,paddingVertical:8,gap:6},
  navItem:{width:98,minHeight:62,borderRadius:16,alignItems:"center",justifyContent:"center",paddingHorizontal:6},
  navItemActive:{backgroundColor:"#f0f8f9"},
  navIcon:{width:34,height:30,borderRadius:10,alignItems:"center",justifyContent:"center"},
  navIconOn:{backgroundColor:"#e5f2f4"},
  navGlyph:{fontSize:15,fontWeight:"900",color:"#728184"},
  navGlyphOn:{color:"#286a75"},
  navText:{fontSize:11,fontWeight:"800",color:"#68777a",marginTop:3},
  navTextOn:{color:"#286a75"},
});
