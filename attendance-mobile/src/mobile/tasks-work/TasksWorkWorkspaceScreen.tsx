import {SafeAreaView,ScrollView,StatusBar,StyleSheet,Text,TouchableOpacity,View} from "react-native";
import {useState} from "react";
import type {MobileSession} from "../auth";
import type {SessionUpdater} from "../apiClient";
import {OverviewTab} from "./OverviewTab";
import {TasksTab} from "./TasksTab";
import {ProjectsTab} from "./ProjectsTab";
import {InboxTab} from "./InboxTab";
import {SetupTab} from "./SetupTab";

type Tab="overview"|"tasks"|"projects"|"inbox"|"setup";
const tabs:{id:Tab;label:string;icon:string;hint:string}[]=[
  {id:"overview",label:"Overview",icon:"O",hint:"Work activity"},
  {id:"tasks",label:"Tasks",icon:"T",hint:"Assigned work"},
  {id:"projects",label:"Projects",icon:"P",hint:"Project tracking"},
  {id:"inbox",label:"Inbox",icon:"I",hint:"Requests & updates"},
  {id:"setup",label:"Setup",icon:"S",hint:"Work configuration"},
];

export function TasksWorkWorkspaceScreen({session,onSession,onBack}:{session:MobileSession;onSession:SessionUpdater;onBack:()=>void}){
  const[tab,setTab]=useState<Tab>("overview");
  const active=tabs.find(x=>x.id===tab)??tabs[0];
  const content=tab==="overview"?<OverviewTab session={session} onSession={onSession}/>:tab==="tasks"?<TasksTab session={session} onSession={onSession}/>:tab==="projects"?<ProjectsTab session={session} onSession={onSession}/>:tab==="inbox"?<InboxTab session={session} onSession={onSession}/>:<SetupTab session={session} onSession={onSession}/>;
  return <SafeAreaView style={s.root}>
    <StatusBar barStyle="light-content" backgroundColor="#1d2f49"/>
    <View style={s.header}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={s.back}><Text style={s.backText}>←</Text></TouchableOpacity>
      <View style={s.headerCopy}><Text style={s.eyebrow}>TASKS & WORK</Text><Text style={s.title}>{active.label}</Text><Text style={s.hint}>{active.hint}</Text></View>
    </View>
    <View style={s.tabsShell}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>{tabs.map(x=><TouchableOpacity accessibilityRole="tab" accessibilityState={{selected:tab===x.id}} key={x.id} onPress={()=>setTab(x.id)} style={[s.tab,tab===x.id&&s.tabOn]}><Text style={[s.tabIcon,tab===x.id&&s.tabTextOn]}>{x.icon}</Text><Text style={[s.tabText,tab===x.id&&s.tabTextOn]}>{x.label}</Text></TouchableOpacity>)}</ScrollView></View>
    <View style={s.body}>{content}</View>
  </SafeAreaView>;
}

const s=StyleSheet.create({
  root:{flex:1,backgroundColor:"#f3f6f4"},
  header:{minHeight:92,backgroundColor:"#1d2f49",paddingHorizontal:14,paddingVertical:12,flexDirection:"row",alignItems:"center"},
  back:{width:48,height:48,borderRadius:15,backgroundColor:"#2b4669",alignItems:"center",justifyContent:"center",marginRight:12},
  backText:{color:"white",fontSize:24,fontWeight:"700"},
  headerCopy:{flex:1},
  eyebrow:{fontSize:11,fontWeight:"900",letterSpacing:1.05,color:"#9bc4ff"},
  title:{fontSize:22,fontWeight:"900",color:"white",marginTop:2},
  hint:{fontSize:12,color:"#b7c9e0",marginTop:2},
  tabsShell:{backgroundColor:"#e7edf4",borderBottomWidth:1,borderBottomColor:"#d4dee9"},
  tabs:{paddingHorizontal:10,paddingVertical:9,gap:8},
  tab:{minWidth:94,minHeight:58,borderRadius:15,backgroundColor:"#f6f8fa",alignItems:"center",justifyContent:"center",paddingHorizontal:12},
  tabOn:{backgroundColor:"#2b4b74"},
  tabIcon:{fontSize:14,fontWeight:"900",color:"#5f7289"},
  tabText:{fontSize:11,fontWeight:"900",color:"#52677f",marginTop:2},
  tabTextOn:{color:"white"},
  body:{flex:1},
});
