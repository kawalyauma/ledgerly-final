import {useEffect,useMemo,useState} from "react";
import {Alert,RefreshControl,ScrollView,StyleSheet,Text,TouchableOpacity,View} from "react-native";
import {MobileApiError,type MobileSession} from "../auth";
import type {SessionUpdater} from "../apiClient";
import {schoolApi} from "./api";
import {schoolPayApi,type SchoolPayIntent} from "./schoolpayApi";
import type {Student} from "./types";
import {Card,Empty,ErrorNotice,Field,Pill,PrimaryButton,SecondaryButton,SectionTitle,SelectField} from "./ui";

type Mode="collect"|"history";
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);
const isNetworkError=(e:unknown)=>e instanceof MobileApiError&&e.status===0;
const studentName=(x:Student)=>[x.firstName,x.middleName,x.lastName].filter(Boolean).join(" ")||"Student";
const ugx=(value:unknown)=>`UGX ${Number(value||0).toLocaleString("en-UG",{maximumFractionDigits:0})}`;
const newExternalReference=(studentId:string)=>`MOB-${Date.now()}-${studentId.slice(-8)}-${Math.random().toString(36).slice(2,8)}`.slice(0,250);
const tone=(status:string):"neutral"|"good"|"warn"|"bad"=>status==="paid"?"good":status==="failed"||status==="posting_failed"?"bad":"warn";

export function SchoolPayTab({session,onSession}:{session:MobileSession;onSession:SessionUpdater}){
  const client={session,onSession};
  const[mode,setMode]=useState<Mode>("collect");
  const[students,setStudents]=useState<Student[]>([]);
  const[intents,setIntents]=useState<SchoolPayIntent[]>([]);
  const[health,setHealth]=useState<Record<string,any>|null>(null);
  const[online,setOnline]=useState(true);
  const[loading,setLoading]=useState(false);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState("");
  const[studentId,setStudentId]=useState("");
  const[amount,setAmount]=useState("");
  const[phone,setPhone]=useState("");
  const[reason,setReason]=useState("School fees payment");
  const[eventType,setEventType]=useState<"SCHOOL_FEES"|"OTHER_FEES">("SCHOOL_FEES");
  const[method,setMethod]=useState<"request"|"register">("request");
  const[attemptReference,setAttemptReference]=useState("");
  const studentOptions=useMemo(()=>students.map(x=>({label:studentName(x),value:x.id,detail:x.admissionNumber||x.studentNumber||"No admission number"})),[students]);
  const selectedStudent=students.find(x=>x.id===studentId);
  const changePayment=(change:()=>void)=>{setAttemptReference("");change()};

  async function load(){
    setLoading(true);setError("");
    try{
      const studentRows=await schoolApi.students(client,{status:"active",limit:500});
      setStudents(studentRows);
      const[rows,diagnostics]=await Promise.all([schoolPayApi.intents(client),schoolPayApi.health(client)]);
      setIntents(rows);setHealth(diagnostics);setOnline(true);
    }catch(e){
      if(isNetworkError(e))setOnline(false);
      setError(errorText(e));
    }finally{setLoading(false)}
  }
  useEffect(()=>{void load()},[session.accessToken]);

  async function collect(){
    if(!online)return Alert.alert("Internet required","SchoolPay collections are never queued offline. Reconnect, refresh, then send the request again.");
    const value=Number(amount.replace(/,/g,"").trim());
    if(!studentId)return Alert.alert("Choose a learner");
    if(!Number.isSafeInteger(value)||value<=0)return Alert.alert("Enter a valid amount","SchoolPay accepts positive whole UGX amounts.");
    if(!reason.trim())return Alert.alert("Enter a payment reason");
    if(method==="request"&&phone.trim().length<7)return Alert.alert("Enter the payer phone number");
    const externalReference=attemptReference||newExternalReference(studentId);
    if(!attemptReference)setAttemptReference(externalReference);
    setBusy(true);setError("");
    try{
      const base={studentPaymentCode:studentId,externalReference,amount:value,reason:reason.trim(),eventType};
      const created=method==="request"?await schoolPayApi.request(client,{...base,phoneNumber:phone.trim()}):await schoolPayApi.register(client,base);
      Alert.alert(method==="request"?"Debit request sent":"Payment registered",created.paymentReference?`SchoolPay reference: ${created.paymentReference}`:"SchoolPay accepted the request.");
      setAmount("");setAttemptReference("");setOnline(true);await load();setMode("history");
    }catch(e){
      if(isNetworkError(e))setOnline(false);
      Alert.alert("SchoolPay request failed",errorText(e));
    }finally{setBusy(false)}
  }

  async function refreshStatus(item:SchoolPayIntent){
    if(!item.paymentReference)return;
    if(!online)return Alert.alert("Internet required","Reconnect before checking SchoolPay status.");
    setBusy(true);
    try{
      const result=await schoolPayApi.status(client,item.paymentReference);
      Alert.alert("SchoolPay status",String(result.status||result.providerStatus||"Checked").replace(/_/g," "));
      setOnline(true);await load();
    }catch(e){if(isNetworkError(e))setOnline(false);Alert.alert("Couldn’t check payment",errorText(e))}
    finally{setBusy(false)}
  }

  async function recover(){
    if(!online)return Alert.alert("Internet required","Reconnect before recovering pending SchoolPay payments.");
    setBusy(true);
    try{await schoolPayApi.recover(client);setOnline(true);await load();Alert.alert("Recovery complete","Pending SchoolPay payments were checked against the provider.")}
    catch(e){if(isNetworkError(e))setOnline(false);Alert.alert("Recovery failed",errorText(e))}
    finally{setBusy(false)}
  }

  return <View style={s.root}>
    <View style={s.modeBar}>
      <TouchableOpacity accessibilityRole="tab" accessibilityState={{selected:mode==="collect"}} style={[s.mode,mode==="collect"&&s.modeOn]} onPress={()=>setMode("collect")}><Text style={[s.modeText,mode==="collect"&&s.modeTextOn]}>Collect payment</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="tab" accessibilityState={{selected:mode==="history"}} style={[s.mode,mode==="history"&&s.modeOn]} onPress={()=>setMode("history")}><Text style={[s.modeText,mode==="history"&&s.modeTextOn]}>Payment history</Text></TouchableOpacity>
    </View>
    <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={load}/>} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
      <View style={s.connection}><View style={{flex:1,paddingRight:10}}><Text style={s.connectionTitle}>SchoolPay connection</Text><Text style={s.connectionText}>{online?"Ready for live payment requests and status checks":"Offline · payment actions are disabled"}</Text></View><Pill text={online?(String(health?.status||"online")):"offline"} tone={online?"good":"bad"}/></View>
      {!online?<View style={s.offline}><Text style={s.offlineTitle}>Internet connection required</Text><Text style={s.offlineText}>SchoolPay payments are never placed in the offline queue. This prevents an old payment request from being sent later without the cashier seeing it happen.</Text><SecondaryButton title="Check connection" onPress={()=>void load()}/></View>:null}
      {error&&online?<ErrorNotice message={error} onRetry={load}/>:null}
      {mode==="collect"?<>
        <SectionTitle title="Collect school fees" subtitle="Choose a learner, confirm the amount, then send the request."/>
        <Card>
          <Text style={s.groupTitle}>1. Learner</Text>
          <SelectField label="Learner account" value={studentId} onChange={x=>changePayment(()=>setStudentId(x))} options={studentOptions} placeholder="Choose learner"/>
          {selectedStudent?<View style={s.selected}><Text style={s.selectedName}>{studentName(selectedStudent)}</Text><Text style={s.selectedMeta}>{selectedStudent.admissionNumber||selectedStudent.studentNumber||"Active learner"}</Text></View>:null}
          <View style={s.divider}/>
          <Text style={s.groupTitle}>2. Payment details</Text>
          <Field label="Amount in Uganda shillings" value={amount} onChangeText={x=>changePayment(()=>setAmount(x.replace(/[^0-9]/g,"")))} keyboardType="number-pad" placeholder="150000"/>
          <SelectField label="Collection method" value={method} onChange={x=>changePayment(()=>setMethod(x as "request"|"register"))} options={[{label:"Instant debit request",value:"request",detail:"Send a payment prompt to the payer phone"},{label:"Register payment",value:"register",detail:"Create a SchoolPay payment reference without a phone prompt"}]}/>
          <SelectField label="Fee type" value={eventType} onChange={x=>changePayment(()=>setEventType(x as "SCHOOL_FEES"|"OTHER_FEES"))} options={[{label:"School fees",value:"SCHOOL_FEES"},{label:"Other / supplementary fee",value:"OTHER_FEES"}]}/>
          {method==="request"?<Field label="Payer phone number" value={phone} onChangeText={x=>changePayment(()=>setPhone(x))} keyboardType="phone-pad" placeholder="0772 123 456"/>:null}
          <Field label="Payment reason" value={reason} onChangeText={x=>changePayment(()=>setReason(x))} maxLength={500}/>
          <View style={s.safety}><Text style={s.safetyTitle}>Before sending</Text><Text style={s.safetyText}>{method==="request"?"Confirm the learner, amount and phone number. The payer should approve the prompt only once.":"Confirm the learner and amount. Ledgerly will create a SchoolPay reference for this payment."}</Text></View>
          <PrimaryButton title={busy?"Sending…":method==="request"?"Send SchoolPay debit request":"Register SchoolPay payment"} disabled={busy||!online} onPress={()=>void collect()}/>
        </Card>
      </>:<>
        <SectionTitle title="Recent SchoolPay payments" subtitle={`${intents.length} payment${intents.length===1?"":"s"} loaded`} action="Recover" onAction={()=>void recover()}/>
        {!intents.length&&!loading?<Empty title="No SchoolPay payments yet" copy="Payments initiated from Ledgerly will appear here with their latest provider status."/>:intents.map(item=><Card key={item.id} style={s.payment}>
          <View style={s.row}><View style={{flex:1,paddingRight:10}}><Text style={s.name}>{[item.firstName,item.lastName].filter(Boolean).join(" ")||item.studentPaymentCode}</Text><Text style={s.reference} numberOfLines={2}>{item.paymentReference||item.externalReference}</Text></View><Pill text={item.status.replace(/_/g," ")} tone={tone(item.status)}/></View>
          <Text style={s.amount}>{ugx(item.amountMinor)}</Text>
          <View style={s.detailRow}><Text style={s.detailLabel}>Method</Text><Text style={s.detailValue}>{item.method==="request"?"Instant debit":"Registered payment"}</Text></View>
          {item.receiptNumber?<View style={s.detailRow}><Text style={s.detailLabel}>Receipt</Text><Text style={s.detailValue}>{item.receiptNumber}</Text></View>:null}
          {item.providerStatus?<View style={s.detailRow}><Text style={s.detailLabel}>Provider</Text><Text style={s.detailValue}>{item.providerStatus}</Text></View>:null}
          {item.error?<View style={s.paymentError}><Text style={s.errorText}>{item.error}</Text></View>:null}
          {item.paymentReference&&item.status!=="paid"?<View style={s.action}><SecondaryButton title={busy?"Checking…":"Check latest status"} compact onPress={()=>void refreshStatus(item)}/></View>:null}
        </Card>)}
      </>}
    </ScrollView>
  </View>;
}

const s=StyleSheet.create({
 root:{flex:1},modeBar:{minHeight:58,backgroundColor:"white",borderBottomWidth:1,borderBottomColor:"#d9e3de",flexDirection:"row",padding:7,gap:7},mode:{flex:1,minHeight:44,borderRadius:12,alignItems:"center",justifyContent:"center",paddingHorizontal:8},modeOn:{backgroundColor:"#e5f5ec"},modeText:{fontSize:13,lineHeight:17,fontWeight:"800",color:"#687a71"},modeTextOn:{color:"#126f49",fontWeight:"900"},
 scroll:{padding:16,paddingBottom:34,gap:14},connection:{backgroundColor:"#071c16",borderRadius:20,padding:18,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},connectionTitle:{color:"white",fontSize:17,lineHeight:22,fontWeight:"900"},connectionText:{color:"#9fbbb0",fontSize:12,lineHeight:17,marginTop:4},
 offline:{backgroundColor:"#fff3e5",borderWidth:1,borderColor:"#ebcc9c",borderRadius:18,padding:16,gap:10},offlineTitle:{fontSize:15,lineHeight:20,fontWeight:"900",color:"#754808"},offlineText:{fontSize:13,lineHeight:19,color:"#795727"},
 groupTitle:{fontSize:15,lineHeight:20,fontWeight:"900",color:"#234236",marginBottom:13},divider:{height:1,backgroundColor:"#e9efec",marginVertical:4,marginBottom:16},selected:{backgroundColor:"#edf8f2",borderRadius:14,padding:13,marginTop:-4,marginBottom:16,borderWidth:1,borderColor:"#d8eee3"},selectedName:{fontSize:15,lineHeight:20,fontWeight:"900",color:"#173126"},selectedMeta:{fontSize:12,lineHeight:17,color:"#64796e",marginTop:3},safety:{backgroundColor:"#f3f7f5",borderRadius:14,padding:14,marginBottom:16,borderWidth:1,borderColor:"#e0e8e4"},safetyTitle:{fontSize:13,lineHeight:17,fontWeight:"900",color:"#2f4d40"},safetyText:{fontSize:12,lineHeight:18,color:"#65796f",marginTop:4},
 payment:{marginBottom:2},row:{flexDirection:"row",alignItems:"flex-start",gap:10},name:{fontSize:16,lineHeight:21,fontWeight:"900",color:"#173126"},reference:{fontSize:12,lineHeight:17,color:"#6f8078",marginTop:4},amount:{fontSize:24,lineHeight:30,fontWeight:"900",color:"#173126",marginTop:16,marginBottom:10},detailRow:{flexDirection:"row",alignItems:"flex-start",paddingVertical:6,borderTopWidth:1,borderTopColor:"#edf1ef"},detailLabel:{width:74,fontSize:12,lineHeight:17,fontWeight:"800",color:"#6f8178"},detailValue:{flex:1,fontSize:13,lineHeight:18,fontWeight:"700",color:"#334b40"},paymentError:{backgroundColor:"#fff0ef",borderRadius:12,padding:11,marginTop:9},errorText:{fontSize:12,lineHeight:18,color:"#9a4844"},action:{marginTop:14,alignItems:"flex-start"}
});
