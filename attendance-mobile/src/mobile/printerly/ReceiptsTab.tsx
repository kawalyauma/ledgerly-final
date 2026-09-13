import{useEffect,useMemo,useState}from"react";
import{Alert,RefreshControl,ScrollView,StyleSheet,Text,View}from"react-native";
import type{MobileSession}from"../auth";
import type{SessionUpdater}from"../apiClient";
import{Card,Empty,ErrorNotice,Pill,PrimaryButton,SecondaryButton,SectionTitle,SelectField}from"../school/ui";
import{err,money,tone}from"./context";
import{receiptPrintingApi,type ReceiptPrintRow,type ReceiptPrintSettings,type ReceiptPrinter,type ReceiptCostProfile}from"./receiptApi";

export function ReceiptsTab({session,onSession}:{session:MobileSession;onSession:SessionUpdater}){
  const c={session,onSession};
  const[settings,setSettings]=useState<ReceiptPrintSettings>({enabled:true,printerId:null,copies:1,pageSize:"A5",autoChargeFinance:true});
  const[printers,setPrinters]=useState<ReceiptPrinter[]>([]),[automatic,setAutomatic]=useState<ReceiptPrintRow[]>([]),[reprints,setReprints]=useState<ReceiptPrintRow[]>([]),[cost,setCost]=useState<ReceiptCostProfile|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  async function load(){setLoading(true);setError("");try{const[s,p,a,r,cp]=await Promise.all([receiptPrintingApi.settings(c),receiptPrintingApi.printers(c),receiptPrintingApi.dispatches(c),receiptPrintingApi.reprints(c),receiptPrintingApi.costing(c)]);setSettings(s);setPrinters(p);setAutomatic(a);setReprints(r);setCost(cp)}catch(e){setError(err(e))}finally{setLoading(false)}}
  useEffect(()=>{void load()},[session.accessToken]);
  const rows=useMemo(()=>[...automatic,...reprints].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)),[automatic,reprints]);
  const costingReady=Boolean(cost?.expenseAccountId&&cost?.offsetAccountId&&[cost.paperCostMinor,cost.bwTonerCostMinor,cost.maintenanceCostMinor,cost.electricityCostMinor].some(x=>Number(x)>0));
  async function run(fn:()=>Promise<any>,message:string){setLoading(true);setError("");setNotice("");try{await fn();setNotice(message);await load()}catch(e){setError(err(e))}finally{setLoading(false)}}
  async function save(){await run(()=>receiptPrintingApi.saveSettings(c,settings),"Receipt printing settings saved.")}
  function confirmReprint(row:ReceiptPrintRow){Alert.alert("Reprint receipt?",`${row.receiptNumber} will be printed again and this physical print will have its own Printerly Finance cost.`,[{text:"Cancel",style:"cancel"},{text:"Reprint",onPress:()=>void run(()=>receiptPrintingApi.reprint(c,row.paymentId),"Receipt reprint sent to Printerly.")}])}
  return <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={load}/>} contentContainerStyle={s.scroll}>
    {error?<ErrorNotice message={error} onRetry={load}/>:null}{notice?<Card><Text style={s.good}>{notice}</Text></Card>:null}
    <SectionTitle title="Automatic receipts" subtitle="Every posted Ledgerly receipt can be printed immediately and charged to Finance"/>
    <Card>
      <SelectField label="Automatic printing" value={String(settings.enabled)} onChange={v=>setSettings(x=>({...x,enabled:v==="true"}))} options={[{label:"Enabled",value:"true"},{label:"Disabled",value:"false"}]}/>
      <SelectField label="Preferred printer" value={settings.printerId||""} onChange={v=>setSettings(x=>({...x,printerId:v||null}))} options={[{label:"Any ready Printerly printer",value:""},...printers.map(p=>({label:p.name,value:p.id,detail:[p.location,p.status].filter(Boolean).join(" · ")}))]}/>
      <SelectField label="Copies" value={String(settings.copies)} onChange={v=>setSettings(x=>({...x,copies:Number(v)}))} options={[1,2,3,4,5].map(v=>({label:String(v),value:String(v)}))}/>
      <SelectField label="Paper size" value={settings.pageSize} onChange={v=>setSettings(x=>({...x,pageSize:v as ReceiptPrintSettings["pageSize"]}))} options={["A5","A4","Letter","Legal"].map(v=>({label:v,value:v}))}/>
      <SelectField label="Finance charging" value={String(settings.autoChargeFinance)} onChange={v=>setSettings(x=>({...x,autoChargeFinance:v==="true"}))} options={[{label:"Post print cost automatically",value:"true"},{label:"Do not auto-post receipt print cost",value:"false"}]}/>
      <PrimaryButton title="Save receipt policy" onPress={()=>void save()}/>
    </Card>
    <SectionTitle title="Finance readiness" subtitle="Originals and reprints are costed independently"/>
    <Card><View style={s.statusRow}><Pill text={costingReady?"Ready":"Setup needed"} tone={costingReady?"good":"warn"}/><Text style={s.statusCopy}>{costingReady?"Expense/offset accounts and at least one non-zero print cost are configured.":"Configure Printerly costing and Finance accounts in Admin before automatic charges can post."}</Text></View></Card>
    <SectionTitle title="Receipt print history" subtitle={`${automatic.length} automatic · ${reprints.length} reprint${reprints.length===1?"":"s"}`}/>
    {rows.length?rows.map(row=><Card key={`${row.kind}-${row.id}`}><View style={s.top}><View style={{flex:1}}><Text style={s.receipt}>{row.receiptNumber}</Text><Text style={s.meta}>{row.kind==="reprint"?"REPRINT":"AUTOMATIC"} · {row.paymentDate}</Text><Text style={s.amount}>{money(row.amountMinor,row.currency)}</Text></View><View style={s.badges}><Pill text={row.status.replaceAll("_"," ")} tone={tone(row.status)}/><Pill text={`finance ${row.financeStatus.replaceAll("_"," ")}`} tone={tone(row.financeStatus)}/></View></View>{row.jobNumber?<Text style={s.meta}>Printerly job {row.jobNumber}</Text>:null}{row.financeJournalId?<Text style={s.meta}>Finance journal {row.financeJournalId}</Text>:null}{row.requestedByName?<Text style={s.meta}>Requested by {row.requestedByName}</Text>:null}{row.lastError?<Text style={s.error}>{row.lastError}</Text>:null}<View style={s.actions}>{row.kind==="automatic"&&["failed","waiting_printer","pending"].includes(row.status)?<SecondaryButton compact title="Retry" onPress={()=>void run(()=>receiptPrintingApi.retryAutomatic(c,row.paymentId),"Receipt print retry queued.")}/>:null}{row.kind==="reprint"&&(row.status==="failed"||row.financeStatus==="failed")?<SecondaryButton compact title="Retry" onPress={()=>void run(()=>receiptPrintingApi.retryReprint(c,row.id),"Reprint retry queued.")}/>:null}{row.status==="completed"?<PrimaryButton compact title="Reprint" onPress={()=>confirmReprint(row)}/>:null}</View></Card>):<Card><Empty title="No receipt print activity" copy="Posted receipts will appear here automatically."/></Card>}
  </ScrollView>;
}

const s=StyleSheet.create({scroll:{padding:16,paddingBottom:42,gap:12},good:{fontSize:13,fontWeight:"800",color:"#28734c"},statusRow:{gap:9},statusCopy:{fontSize:13,lineHeight:19,color:"#5f6e66"},top:{flexDirection:"row",gap:12,alignItems:"flex-start"},receipt:{fontSize:16,fontWeight:"900",color:"#283d35"},meta:{fontSize:11,lineHeight:16,color:"#7b8982",marginTop:3},amount:{fontSize:14,fontWeight:"900",color:"#3e554b",marginTop:5},badges:{alignItems:"flex-end",gap:6,maxWidth:"48%"},error:{fontSize:11,lineHeight:16,color:"#a23b35",marginTop:8},actions:{flexDirection:"row",gap:8,flexWrap:"wrap",marginTop:10}});
