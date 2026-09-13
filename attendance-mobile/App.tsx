import {useEffect,useState} from "react";
import {ActivityIndicator,Alert,AppState,StatusBar,StyleSheet,Text,View} from "react-native";
import {ActivationScreen} from "./src/ActivationScreen";
import {KioskExperienceScreen} from "./src/KioskExperienceScreen";
import {fetchDeviceContext} from "./src/api";
import {DeviceManager} from "./src/native";
import type {Registration} from "./src/types";
import {clearMobileSession,completeOnboarding,logoutMobile,onboardingComplete,pinLoginMobile,readMobileAuthContext,readMobileSession,refreshMobile,saveMobileSession,trustMobileDevice,type MobileAuthContext,type MobileSession} from "./src/mobile/auth";
import {MobilePinLockScreen} from "./src/mobile/MobilePinLockScreen";
import {HomeScreen} from "./src/mobile/HomeScreen";
import {LoginScreen} from "./src/mobile/LoginScreen";
import {OnboardingScreen} from "./src/mobile/OnboardingScreen";
import {AttendanceModuleScreen} from "./src/mobile/AttendanceModuleScreen";
import {AttendanceWorkspaceScreen} from "./src/mobile/attendance/AttendanceWorkspaceScreen";
import {SchoolWorkspaceScreen} from "./src/mobile/school/SchoolWorkspaceScreen";
import {AcademicsWorkspaceScreen} from "./src/mobile/academics/AcademicsWorkspaceScreen";
import {ExamsWorkspaceScreen} from "./src/mobile/exams/ExamsWorkspaceScreen";
import {BooksWorkspaceScreen} from "./src/mobile/books/BooksWorkspaceScreen";
import {HumanResourcesWorkspaceScreen} from "./src/mobile/human-resources/HumanResourcesWorkspaceScreen";
import {PayrollPaymentsWorkspaceScreen} from "./src/mobile/payroll-payments/PayrollPaymentsWorkspaceScreen";
import {ContactsWorkspaceScreen} from "./src/mobile/contacts/ContactsWorkspaceScreen";
import {CommunicationsWorkspaceScreen} from "./src/mobile/communications/CommunicationsWorkspaceScreen";
import {TasksWorkWorkspaceScreen} from "./src/mobile/tasks-work/TasksWorkWorkspaceScreen";
import {AgenticEmployeesWorkspaceScreen} from "./src/mobile/agentic-employees/AgenticEmployeesWorkspaceScreen";
import {FinanceCoreWorkspaceScreen} from "./src/mobile/finance-core/FinanceCoreWorkspaceScreen";
import {PrinterlyWorkspaceScreen} from "./src/mobile/printerly/PrinterlyWorkspaceScreen";
import {SecurityCamerasWorkspaceScreen} from "./src/mobile/security-cameras/SecurityCamerasWorkspaceScreen";
import {DevicePurposeScreen} from "./src/mobile/device-purpose/DevicePurposeScreen";
import {readDevicePurpose,saveDevicePurpose,type DevicePurpose} from "./src/mobile/device-purpose/devicePurpose";
import {CameraModeScreen} from "./src/mobile/camera/CameraModeScreen";
import {clearMobileSyncAccountData} from "./src/mobile/syncClient";
import {useNormalMobileSync} from "./src/mobile/syncRuntime";

type Route="home"|"attendance"|"school"|"academics"|"exams"|"books"|"human-resources"|"payroll-payments"|"contacts"|"communications"|"tasks-work"|"agentic-employees"|"finance-core"|"printerly"|"security-cameras";
type KioskContext={organizationId:string;deviceCode:string;name:string;locationName?:string|null};

export default function App(){
  const[ready,setReady]=useState(false),[onboarded,setOnboarded]=useState(false),[session,setSession]=useState<MobileSession|null>(null),[purpose,setPurpose]=useState<DevicePurpose|null>(null),[purposeSettingsOpen,setPurposeSettingsOpen]=useState(false),[route,setRoute]=useState<Route>("home"),[attendanceView,setAttendanceView]=useState<"landing"|"workspace"|"register"|"kiosk">("landing"),[registration,setRegistration]=useState<Registration|null|undefined>(undefined);
  const[authContext,setAuthContext]=useState<MobileAuthContext|null>(null),[locked,setLocked]=useState(false),[forcePasswordLogin,setForcePasswordLogin]=useState(false),[passwordBypassOnce,setPasswordBypassOnce]=useState(false);
  const[kioskPinRequested,setKioskPinRequested]=useState(false),[kioskEmployeeMode,setKioskEmployeeMode]=useState(false),[kioskContext,setKioskContext]=useState<KioskContext|null>(null);
  useNormalMobileSync(session,purpose,updateSession);

  useEffect(()=>{let live=true;(async()=>{
    const[seen,saved,device,savedPurpose,context]=await Promise.all([onboardingComplete().catch(()=>false),readMobileSession().catch(()=>null),DeviceManager.getRegistration().catch(()=>null),readDevicePurpose().catch(()=>null),readMobileAuthContext().catch(()=>null)]);
    if(!live)return;setOnboarded(seen);setRegistration(device);setPurpose(savedPurpose);setAuthContext(context);
    if(saved){try{const renewed=await refreshMobile(saved);if(live){await saveMobileSession(renewed);setSession(renewed);if(savedPurpose==="normal"){const trusted=await trustMobileDevice(renewed).catch(()=>context);if(live&&trusted){setAuthContext(trusted);setLocked(true)}}}}catch(e:any){if(e?.status===401){await clearMobileSession();if(live&&context&&savedPurpose==="normal")setLocked(true)}else if(live){setSession(saved);if(savedPurpose==="normal"&&context)setLocked(true)}}}
    else if(context&&savedPurpose==="normal")setLocked(true);
    setReady(true);
  })();return()=>{live=false}},[]);

  useEffect(()=>{const sub=AppState.addEventListener("change",state=>{if((state==="inactive"||state==="background")&&session&&(purpose==="normal"||kioskEmployeeMode))setLocked(true)});return()=>sub.remove()},[kioskEmployeeMode,purpose,session]);

  async function finishOnboarding(){await completeOnboarding();setOnboarded(true)}
  async function signedIn(next:MobileSession){
    await saveMobileSession(next);setSession(next);setRoute("home");setForcePasswordLogin(false);
    const trusted=await trustMobileDevice(next).catch(()=>null);if(trusted)setAuthContext(trusted);
    setLocked(!passwordBypassOnce&&!!trusted);setPasswordBypassOnce(false);
  }
  async function updateSession(next:MobileSession){await saveMobileSession(next);setSession(next)}
  async function choosePurpose(next:DevicePurpose){await saveDevicePurpose(next);setPurpose(next);setPurposeSettingsOpen(false);setKioskEmployeeMode(false);setKioskPinRequested(false);setRoute(next==="attendance-kiosk"?"attendance":"home");setAttendanceView(next==="attendance-kiosk"?(registration?"kiosk":"register"):"landing")}
  function changePurpose(){setPurposeSettingsOpen(true)}
  function usePasswordInstead(){setPasswordBypassOnce(true);setForcePasswordLogin(true);setLocked(false);setSession(null);void clearMobileSession()}
  function requestLogout(){Alert.alert("Sign out?","You will need your Ledgerly credentials or employee PIN to sign in again.",[{text:"Cancel",style:"cancel"},{text:"Sign out",style:"destructive",onPress:()=>{const current=session;setSession(null);setLocked(false);setForcePasswordLogin(false);setRoute("home");if(purpose==="attendance-kiosk")setKioskEmployeeMode(false);void Promise.all([clearMobileSession(),clearMobileSyncAccountData()]);if(current)void logoutMobile(current)}}])}

  async function unlockNormal(pin:string){
    if(!authContext)throw new Error("This phone has not been trusted yet. Use your full password once.");
    const next=await pinLoginMobile({apiUrl:authContext.apiUrl,organizationId:authContext.organizationId,pin,context:authContext});
    await saveMobileSession(next);setSession(next);setLocked(false);setForcePasswordLogin(false);setRoute("home");
  }
  async function requestKioskLock(){
    if(!registration)return;
    try{const context=await fetchDeviceContext(registration);setKioskContext(context);setKioskPinRequested(true)}catch(e){Alert.alert("Unable to open employee lock",e instanceof Error?e.message:String(e))}
  }
  async function unlockKiosk(pin:string){
    if(!registration||!kioskContext)throw new Error("Kiosk school context is unavailable.");
    const next=await pinLoginMobile({apiUrl:registration.apiUrl,organizationId:kioskContext.organizationId,pin,registration});
    await saveMobileSession(next);setSession(next);setKioskPinRequested(false);setKioskEmployeeMode(true);setLocked(false);setRoute("home");
    const trusted=await trustMobileDevice(next).catch(()=>null);if(trusted)setAuthContext(trusted);
  }

  if(!ready)return <View style={s.loading}><StatusBar barStyle="light-content" backgroundColor="#071c16"/><View style={s.loaderMark}><Text style={s.loaderLetter}>L</Text></View><ActivityIndicator color="#55c894" style={{marginTop:18}}/><Text style={s.loadingText}>Preparing Ledgerly Mobile</Text></View>;
  if(!onboarded)return <OnboardingScreen onDone={()=>void finishOnboarding()}/>;
  if(!purpose)return <DevicePurposeScreen onSelect={next=>void choosePurpose(next)}/>;
  if(purposeSettingsOpen)return <DevicePurposeScreen current={purpose} onSelect={next=>void choosePurpose(next)} onBack={()=>setPurposeSettingsOpen(false)}/>;
  if(purpose==="security-camera")return <CameraModeScreen onChangePurpose={()=>void changePurpose()}/>;

  if(purpose==="attendance-kiosk"&&!kioskEmployeeMode){
    if(registration===undefined)return <View style={s.loading}><ActivityIndicator color="#55c894"/></View>;
    if(!registration)return <ActivationScreen onActivated={(next:Registration)=>{setRegistration(next);setAttendanceView("kiosk")}}/>;
    if(kioskPinRequested&&kioskContext)return <MobilePinLockScreen heading="Unlock employee workspace" schoolLabel={kioskContext.name||"Ledgerly attendance kiosk"} onUnlock={unlockKiosk}/>;
    return <><StatusBar hidden/><KioskExperienceScreen registration={registration} onReset={()=>{setRegistration(null);setAttendanceView("register")}} onOpenSettings={changePurpose} onRequestPinLock={()=>void requestKioskLock()}/></>;
  }

  if(kioskPinRequested&&kioskContext&&registration)return <MobilePinLockScreen heading="Unlock employee workspace" schoolLabel={kioskContext.name||"Ledgerly attendance kiosk"} onUnlock={unlockKiosk}/>;
  if((locked||(!session&&!!authContext&&!forcePasswordLogin))&&authContext)return <MobilePinLockScreen heading={session?"Ledgerly is locked":"Employee sign in"} schoolLabel="Trusted school device" employeeLabel={session?.displayName} onUnlock={unlockNormal} onUsePassword={usePasswordInstead}/>;
  if(!session)return <LoginScreen onLogin={signedIn}/>;
  if(route==="school")return <SchoolWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setRoute("home")}/>;
  if(route==="academics")return <AcademicsWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setRoute("home")}/>;
  if(route==="exams")return <ExamsWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setRoute("home")}/>;
  if(route==="books")return <BooksWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setRoute("home")}/>;
  if(route==="human-resources")return <HumanResourcesWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setRoute("home")}/>;
  if(route==="payroll-payments")return <PayrollPaymentsWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setRoute("home")}/>;
  if(route==="contacts")return <ContactsWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setRoute("home")}/>;
  if(route==="communications")return <CommunicationsWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setRoute("home")}/>;
  if(route==="tasks-work")return <TasksWorkWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setRoute("home")}/>;
  if(route==="agentic-employees")return <AgenticEmployeesWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setRoute("home")}/>;
  if(route==="finance-core")return <FinanceCoreWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setRoute("home")}/>;
  if(route==="printerly")return <PrinterlyWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setRoute("home")}/>;
  if(route==="security-cameras")return <SecurityCamerasWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setRoute("home")}/>;
  if(route==="attendance"){if(registration===undefined)return <View style={s.loading}><ActivityIndicator color="#55c894"/></View>;if(attendanceView==="register")return <ActivationScreen onActivated={(next:Registration)=>{setRegistration(next);setAttendanceView("landing")}}/>;if(attendanceView==="kiosk"&&registration)return <><StatusBar hidden/><KioskExperienceScreen registration={registration} onReset={()=>{setRegistration(null);setAttendanceView("landing")}} onOpenSettings={changePurpose} onRequestPinLock={()=>void requestKioskLock()}/></>;if(attendanceView==="workspace")return <AttendanceWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setAttendanceView("landing")} onOpenKiosk={()=>setAttendanceView(registration?"kiosk":"register")}/>;return <AttendanceModuleScreen registration={registration} onBack={()=>setRoute("home")} onWorkspace={()=>setAttendanceView("workspace")} onRegister={()=>setAttendanceView("register")} onLaunch={()=>setAttendanceView("kiosk")}/>}
  return <HomeScreen session={session} onSession={updateSession} onAttendance={()=>{setAttendanceView("landing");setRoute("attendance")}} onSchool={()=>setRoute("school")} onAcademics={()=>setRoute("academics")} onExams={()=>setRoute("exams")} onBooks={()=>setRoute("books")} onHumanResources={()=>setRoute("human-resources")} onPayrollPayments={()=>setRoute("payroll-payments")} onContacts={()=>setRoute("contacts")} onCommunications={()=>setRoute("communications")} onTasksWork={()=>setRoute("tasks-work")} onAgenticEmployees={()=>setRoute("agentic-employees")} onFinanceCore={()=>setRoute("finance-core")} onPrinterly={()=>setRoute("printerly")} onSecurityCameras={()=>setRoute("security-cameras")} onLogout={requestLogout}/>;
}
const s=StyleSheet.create({loading:{flex:1,backgroundColor:"#071c16",alignItems:"center",justifyContent:"center"},loaderMark:{width:58,height:58,borderRadius:18,backgroundColor:"#19955f",alignItems:"center",justifyContent:"center"},loaderLetter:{color:"white",fontSize:30,fontWeight:"900"},loadingText:{color:"#9fb9ae",fontSize:12,fontWeight:"800",marginTop:10}});
