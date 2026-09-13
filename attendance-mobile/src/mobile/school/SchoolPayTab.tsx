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
const externalReference=(studentId:string)=>`MOB-${Date.now()}-${studentId.slice(-8)}`.slice(0,250);
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
  const studentOptions=useMemo(()=>students.map(x=>({label:studentName(x),value:x.id,detail:x.admissionNumber||x.studentNumber||"No admission number"})),[students]);

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
    setBusy(true);setError("");
    try{
      const base={studentPaymentCode:studentId,externalReference:externalReference(studentId),amount:value,reason:reason.trim(),eventType};
      const created=method==="request"?await schoolPayApi.request(client,{...base,phoneNumber:phone.trim()}):await schoolPayApi.register(client,base);
      Alert.alert(method==="request"?"Debit request sent":"Payment registered",created.paymentReference?`SchoolPay reference: ${created.paymentReference}`:"SchoolPay accepted the request.");
      setAmount("");setOnline(true);await load();setMode("history");
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
      <TouchableOpacity style={[s.mode,mode==="collect"&&s.modeOn]} onPress={()=>setMode("collect")}><Text style={[s.modeText,mode==="collect"&&s.modeTextOn]}>Collect</Text></TouchableOpacity>
      <TouchableOpacity style={[s.mode,mode==="history"&&s.modeOn]} onPress={()=>setMode("history")}><Text style={[s.modeText,mode==="history"&&s.modeTextOn]}>Payments</Text></TouchableOpacity>
    </View>
    <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={load}/>} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
      <View style={s.connection}><View><Text style={s.connectionTitle}>SchoolPay</Text><Text style={s.connectionText}>{online?"Connected to live SchoolPay services":"Offline · collection disabled"}</Text></View><Pill text={online?(String(health?.status||"online")):"offline"} tone={online?"good":"bad"}/></View>
      {!online?<View style={s.offline}><Text style={s.offlineTitle}>Online connection required</Text><Text style={s.offlineText}>For payment safety, SchoolPay debit requests and status checks are not placed in Ledgerly's offline queue. This prevents a request from being sent later without the cashier seeing it happen.</Text><SecondaryButton title="Try connection" onPress={()=>void load()}/></View>:null}
      {error&&online?<ErrorNotice message={error} onRetry={load}/>:null}
      {mode==="collect"?<>
        <SectionTitle title="Collect school fees" subtitle="Send a SchoolPay debit prompt or register an ad-hoc payment"/>
        <Card>
          <SelectField label="Learner" value={studentId} onChange={setStudentId} options={studentOptions} placeholder="Choose learner"/>
          <Field label="Amount (UGX)" value={amount} onChangeText={x=>setAmount(x.replace(/[^0-9]/g,""))} keyboardType="number-pad" placeholder="150000"/>
          <SelectField label="Collection method" value={method} onChange={x=>setMethod(x as "request"|"register")} options={[{label:"Instant debit request",value:"request",detail:"Prompt the payer phone"},{label:"Register payment",value:"register",detail:"Create a SchoolPay payment reference"}]}/>
          <SelectField label="Fee type" value={eventType} onChange={x=>setEventType(x as "SCHOOL_FEES"|"OTHER_FEES")} options={[{label:"School fees",value:"SCHOOL_FEES"},{label:"Other / supplementary fee",value:"OTHER_FEES"}]}/>
          {method==="request"?<Field label="Payer phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="0772 123 456"/>:null}
          <Field label="Reason" value={reason} onChangeText={setReason} maxLength={500}/>
          <PrimaryButton title={busy?"Sending…":method==="request"?"Send debit request":"Register SchoolPay payment"} disabled={busy||!online} onPress={()=>void collect()}/>
        </Card>
      </>:<>
        <SectionTitle title="Recent SchoolPay payments" subtitle={`${intents.length} loaded`} action="Recover" onAction={()=>void recover()}/>
        {!intents.length&&!loading?<Empty title="No SchoolPay payments" copy="Payments initiated from Ledgerly will appear here."/>:intents.map(item=><Card key={item.id} style={s.payment}>
          <View style={s.row}><View style={{flex:1}}><Text style={s.name}>{[item.firstName,item.lastName].filter(Boolean).join(" ")||item.studentPaymentCode}</Text><Text style={s.meta}>{item.paymentReference||item.externalReference}</Text></View><Pill text={item.status.replace(/_/g," ")} tone={tone(item.status)}/></View>
          <Text style={s.amount}>{ugx(item.amountMinor)}</Text>
          <Text style={s.meta}>{item.method==="request"?"Instant debit":"Registered payment"}{item.receiptNumber?` · Receipt ${item.receiptNumber}`:""}</Text>
          {item.error?<Text style={s.errorText}>{item.error}</Text>:null}
          {item.paymentReference&&item.status!=="paid"?<View style={s.action}><SecondaryButton title={busy?"Checking…":"Check status"} compact onPress={()=>void refreshStatus(item)}/></View>:null}
        </Card>)}
      </>}
    </ScrollView>
  </View>;
}

const s=StyleSheet.create({root:{flex:1},modeBar:{height:47,backgroundColor:"white",borderBottomWidth:1,borderBottomColor:"#dfe7e2",flexDirection:"row",padding:6,gap:6},mode:{flex:1,borderRadius:10,alignItems:"center",justifyContent:"center"},modeOn:{backgroundColor:"#e7f6ee"},modeText:{fontSize:10,fontWeight:"900",color:"#839189"},modeTextOn:{color:"#148e5b"},scroll:{padding:14,paddingBottom:30,gap:12},connection:{backgroundColor:"#071c16",borderRadius:18,padding:16,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},connectionTitle:{color:"white",fontSize:17,fontWeight:"900"},connectionText:{color:"#8db3a3",fontSize:9,marginTop:3},offline:{backgroundColor:"#fff3e5",borderWidth:1,borderColor:"#f0d3a7",borderRadius:16,padding:14,gap:8},offlineTitle:{fontSize:12,fontWeight:"900",color:"#7e5011"},offlineText:{fontSize:10,lineHeight:15,color:"#88612b"},payment:{marginBottom:0},row:{flexDirection:"row",alignItems:"flex-start",gap:10},name:{fontSize:13,fontWeight:"900",color:"#173126"},meta:{fontSize:9,lineHeight:14,color:"#7b8c83",marginTop:2},amount:{fontSize:19,fontWeight:"900",color:"#173126",marginTop:12,marginBottom:3},errorText:{fontSize:9,lineHeight:14,color:"#a44340",marginTop:8},action:{marginTop:12,alignItems:"flex-start"}});
