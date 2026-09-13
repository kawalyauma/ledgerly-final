import {useState} from "react";
import {SafeAreaView,ScrollView,StatusBar,StyleSheet,Text,TouchableOpacity,View} from "react-native";
import type {MobileSession} from "../auth";
import type {SessionUpdater} from "../apiClient";
import {OverviewTab} from "./OverviewTab";
import {StockTab} from "./StockTab";
import {IssueTab} from "./IssueTab";
import {LedgerTab} from "./LedgerTab";
import {ReportsTab} from "./ReportsTab";

type Tab="overview"|"stock"|"issue"|"ledger"|"reports";
const tabs:{id:Tab;label:string;icon:string;hint:string}[]=[
  {id:"overview",label:"Overview",icon:"⌂",hint:"Library activity"},
  {id:"stock",label:"Stock",icon:"▣",hint:"Books & inventory"},
  {id:"issue",label:"Issue",icon:"+",hint:"Issue & return books"},
  {id:"ledger",label:"Ledger",icon:"L",hint:"Borrowing history"},
  {id:"reports",label:"Reports",icon:"R",hint:"Library reports"},
];

export function BooksWorkspaceScreen({session,onSession,onBack}:{session:MobileSession;onSession:SessionUpdater;onBack:()=>void}){
  const[tab,setTab]=useState<Tab>("overview");
  const active=tabs.find(x=>x.id===tab)??tabs[0];
  const content=tab==="overview"?<OverviewTab session={session} onSession={onSession}/>:tab==="stock"?<StockTab session={session} onSession={onSession}/>:tab==="issue"?<IssueTab session={session} onSession={onSession}/>:tab==="ledger"?<LedgerTab session={session} onSession={onSession}/>:<ReportsTab session={session} onSession={onSession}/>;
  return <SafeAreaView style={s.root}>
    <StatusBar barStyle="light-content" backgroundColor="#3b291d"/>
    <View style={s.head}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" style={s.back} onPress={onBack}><Text style={s.backText}>←</Text></TouchableOpacity>
      <View style={s.headerCopy}><Text style={s.eyebrow}>BOOKS & LIBRARY</Text><Text style={s.title}>{active.label}</Text><Text style={s.hint}>{active.hint}</Text></View>
      <View style={s.badge}><Text style={s.badgeText}>LIBRARY</Text></View>
    </View>
    <View style={s.body}>{content}</View>
    <View style={s.navShell}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.nav}>
      {tabs.map(x=><TouchableOpacity accessibilityRole="tab" accessibilityState={{selected:tab===x.id}} key={x.id} onPress={()=>setTab(x.id)} style={[s.navItem,tab===x.id&&s.navItemActive]}><View style={[s.navIcon,tab===x.id&&s.navIconOn]}><Text style={[s.navGlyph,tab===x.id&&s.navGlyphOn]}>{x.icon}</Text></View><Text style={[s.navText,tab===x.id&&s.navTextOn]}>{x.label}</Text></TouchableOpacity>)}
    </ScrollView></View>
  </SafeAreaView>;
}

const s=StyleSheet.create({
  root:{flex:1,backgroundColor:"#f7f5f1"},
  head:{minHeight:92,backgroundColor:"#3b291d",flexDirection:"row",alignItems:"center",paddingHorizontal:14,paddingVertical:12},
  back:{width:48,height:48,borderRadius:15,backgroundColor:"#5b4030",alignItems:"center",justifyContent:"center",marginRight:12},
  backText:{fontSize:24,fontWeight:"700",color:"white"},
  headerCopy:{flex:1,minWidth:0},
  eyebrow:{fontSize:11,fontWeight:"900",letterSpacing:1.1,color:"#e7bb7d"},
  title:{fontSize:22,fontWeight:"900",color:"white",marginTop:2},
  hint:{fontSize:12,color:"#dfc7ae",marginTop:2},
  badge:{marginLeft:8,borderRadius:16,backgroundColor:"#f5e6d0",paddingHorizontal:10,paddingVertical:9},
  badgeText:{fontSize:10,fontWeight:"900",color:"#7d522f"},
  body:{flex:1},
  navShell:{backgroundColor:"white",borderTopWidth:1,borderTopColor:"#e8e0d6"},
  nav:{paddingHorizontal:8,paddingVertical:8,gap:6},
  navItem:{width:92,minHeight:62,borderRadius:16,alignItems:"center",justifyContent:"center",paddingHorizontal:6},
  navItemActive:{backgroundColor:"#faf4ed"},
  navIcon:{width:34,height:30,borderRadius:10,alignItems:"center",justifyContent:"center"},
  navIconOn:{backgroundColor:"#f4e9dc"},
  navGlyph:{fontSize:15,fontWeight:"900",color:"#82786f"},
  navGlyphOn:{color:"#8b5a34"},
  navText:{fontSize:11,fontWeight:"800",color:"#746b63",marginTop:3},
  navTextOn:{color:"#8b5a34"},
});
