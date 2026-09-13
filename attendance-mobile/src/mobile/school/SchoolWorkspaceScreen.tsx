import {useState} from "react";
import {SafeAreaView,ScrollView,StatusBar,StyleSheet,Text,TouchableOpacity,View} from "react-native";
import type {MobileSession} from "../auth";
import type {SessionUpdater} from "../apiClient";
import {AdminTab} from "./AdminTab";
import {OperationsTab} from "./OperationsTab";
import {OverviewTab} from "./OverviewTab";
import {SchoolPayTab} from "./SchoolPayTab";
import {StaffTab} from "./StaffTab";
import {StudentsTab} from "./StudentsTab";

type Tab="overview"|"students"|"staff"|"operations"|"schoolpay"|"admin";
const tabs:{id:Tab;label:string;icon:string;hint:string}[]=[
 {id:"overview",label:"Overview",icon:"⌂",hint:"School summary"},
 {id:"students",label:"Learners",icon:"◎",hint:"Students & admissions"},
 {id:"staff",label:"Staff",icon:"♙",hint:"Teachers & employees"},
 {id:"operations",label:"Operations",icon:"▦",hint:"Fees, discipline & promotion"},
 {id:"schoolpay",label:"SchoolPay",icon:"¤",hint:"Collect & verify payments"},
 {id:"admin",label:"Admin",icon:"⚙",hint:"Setup & access"},
];

export function SchoolWorkspaceScreen({session,onSession,onBack}:{session:MobileSession;onSession:SessionUpdater;onBack:()=>void}){
 const[tab,setTab]=useState<Tab>("overview"),common={session,onSession};
 const active=tabs.find(x=>x.id===tab)!;
 return <SafeAreaView style={s.root}><StatusBar barStyle="light-content" backgroundColor="#071c16"/>
  <View style={s.header}>
   <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to modules" style={s.back} onPress={onBack}><Text style={s.backText}>←</Text></TouchableOpacity>
   <View style={s.headerText}><Text style={s.eyebrow}>SCHOOL MANAGEMENT</Text><Text style={s.title}>{active.label}</Text><Text style={s.subtitle}>{active.hint}</Text></View>
   <View style={s.badge}><View style={s.badgeDot}/><Text style={s.badgeText}>LIVE</Text></View>
  </View>
  <View style={s.body}>{tab==="overview"?<OverviewTab {...common}/>:tab==="students"?<StudentsTab {...common}/>:tab==="staff"?<StaffTab {...common}/>:tab==="operations"?<OperationsTab {...common}/>:tab==="schoolpay"?<SchoolPayTab {...common}/>:<AdminTab {...common}/>}</View>
  <View style={s.navWrap}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.nav}>{tabs.map(x=><TouchableOpacity accessibilityRole="tab" accessibilityState={{selected:tab===x.id}} key={x.id} style={[s.navItem,tab===x.id&&s.navItemActive]} onPress={()=>setTab(x.id)}><View style={[s.navIcon,tab===x.id&&s.navIconActive]}><Text style={[s.navIconText,tab===x.id&&s.navIconTextActive]}>{x.icon}</Text></View><Text style={[s.navText,tab===x.id&&s.navTextActive]}>{x.label}</Text></TouchableOpacity>)}</ScrollView></View>
 </SafeAreaView>
}

const s=StyleSheet.create({
 root:{flex:1,backgroundColor:"#f3f6f4"},
 header:{minHeight:92,backgroundColor:"#071c16",paddingHorizontal:16,paddingVertical:12,flexDirection:"row",alignItems:"center"},
 back:{width:48,height:48,borderRadius:14,backgroundColor:"#14382d",alignItems:"center",justifyContent:"center",marginRight:13,borderWidth:1,borderColor:"#214b3c"},backText:{color:"white",fontSize:25,lineHeight:28,fontWeight:"800"},
 headerText:{flex:1,minWidth:0},eyebrow:{color:"#77a190",fontSize:10,lineHeight:13,fontWeight:"900",letterSpacing:.9},title:{color:"white",fontSize:22,lineHeight:27,fontWeight:"900",marginTop:2},subtitle:{color:"#9ab5a9",fontSize:12,lineHeight:17,fontWeight:"600",marginTop:1},
 badge:{borderRadius:14,backgroundColor:"#174735",paddingHorizontal:10,paddingVertical:8,flexDirection:"row",alignItems:"center",gap:6,marginLeft:8},badgeDot:{width:7,height:7,borderRadius:4,backgroundColor:"#59d799"},badgeText:{fontSize:10,fontWeight:"900",color:"#8be5b8",letterSpacing:.6},
 body:{flex:1},
 navWrap:{backgroundColor:"white",borderTopWidth:1,borderTopColor:"#d9e4de",paddingTop:6,paddingBottom:6},
 nav:{paddingHorizontal:8,gap:4},navItem:{width:88,minHeight:64,borderRadius:14,alignItems:"center",justifyContent:"center",paddingHorizontal:5,paddingVertical:6},navItemActive:{backgroundColor:"#f1f9f5"},navIcon:{width:34,height:30,borderRadius:10,alignItems:"center",justifyContent:"center"},navIconActive:{backgroundColor:"#dff3e9"},navIconText:{fontSize:17,color:"#71847a",fontWeight:"900"},navIconTextActive:{color:"#148e5b"},navText:{fontSize:11,lineHeight:14,fontWeight:"800",color:"#6e8077",marginTop:4,textAlign:"center"},navTextActive:{color:"#126f49",fontWeight:"900"}
});
