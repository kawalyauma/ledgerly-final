import {useEffect,useRef,useState} from "react";
import {Animated,SafeAreaView,StatusBar,StyleSheet,Text,TouchableOpacity,View} from "react-native";

type Props={
  heading?:string;
  schoolLabel?:string;
  employeeLabel?:string;
  onUnlock:(pin:string)=>Promise<void>;
  onUsePassword?:()=>void;
};

const keys=["1","2","3","4","5","6","7","8","9","","0","⌫"];

export function MobilePinLockScreen({heading="Ledgerly is locked",schoolLabel="School workspace",employeeLabel,onUnlock,onUsePassword}:Props){
  const[pin,setPin]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const shake=useRef(new Animated.Value(0)).current;
  const glow=useRef(new Animated.Value(0)).current;
  const drift=useRef(new Animated.Value(0)).current;
  useEffect(()=>{
    const a=Animated.loop(Animated.sequence([Animated.timing(glow,{toValue:1,duration:1700,useNativeDriver:true}),Animated.timing(glow,{toValue:0,duration:1700,useNativeDriver:true})]));
    const b=Animated.loop(Animated.sequence([Animated.timing(drift,{toValue:1,duration:6200,useNativeDriver:true}),Animated.timing(drift,{toValue:0,duration:6200,useNativeDriver:true})]));
    a.start();b.start();return()=>{a.stop();b.stop()};
  },[drift,glow]);
  function fail(message:string){
    setError(message);setPin("");
    shake.setValue(0);
    Animated.sequence([8,-8,6,-6,3,-3,0].map((x,i)=>Animated.timing(shake,{toValue:x,duration:i===6?70:45,useNativeDriver:true}))).start();
  }
  async function submit(value:string){
    if(busy||value.length!==4)return;
    setBusy(true);setError("");
    try{await onUnlock(value);setPin("")}catch(e){fail(e instanceof Error?e.message:"Unable to unlock Ledgerly")}finally{setBusy(false)}
  }
  function press(key:string){
    if(busy||!key)return;
    if(key==="⌫"){setPin(x=>x.slice(0,-1));setError("");return}
    if(pin.length>=4)return;
    const next=pin+key;setPin(next);setError("");if(next.length===4)void submit(next);
  }
  const glowScale=glow.interpolate({inputRange:[0,1],outputRange:[1,1.08]});
  const orbX=drift.interpolate({inputRange:[0,1],outputRange:[-26,34]});
  const orbY=drift.interpolate({inputRange:[0,1],outputRange:[24,-28]});
  return <SafeAreaView style={s.root}>
    <StatusBar hidden/>
    <Animated.View pointerEvents="none" style={[s.orb,s.orbA,{transform:[{translateX:orbX},{translateY:orbY}]}]}/>
    <Animated.View pointerEvents="none" style={[s.orb,s.orbB,{transform:[{translateX:Animated.multiply(orbX,-.7)},{translateY:Animated.multiply(orbY,-.6)}]}]}/>
    <View style={s.top}><View style={s.brandMark}><Text style={s.brandLetter}>L</Text></View><Text style={s.brand}>ledgerly</Text><View style={s.secure}><View style={s.secureDot}/><Text style={s.secureText}>SECURE DEVICE</Text></View></View>
    <View style={s.content}>
      <Animated.View style={[s.lockHalo,{transform:[{scale:glowScale}]}]}><View style={s.lockBody}><View style={s.lockShackle}/><View style={s.lockSquare}><View style={s.keyhole}/></View></View></Animated.View>
      <Text style={s.kicker}>EMPLOYEE ACCESS</Text><Text style={s.heading}>{heading}</Text><Text style={s.school}>{schoolLabel}</Text>{employeeLabel?<Text style={s.employee}>{employeeLabel}</Text>:null}
      <Animated.View style={[s.pinRow,{transform:[{translateX:shake}]}]}>{[0,1,2,3].map(i=><View key={i} style={[s.pinDot,pin.length>i&&s.pinDotFilled]}>{pin.length>i?<View style={s.pinInner}/>:null}</View>)}</Animated.View>
      <Text style={[s.helper,error&&s.error]}>{error|| (busy?"Checking your PIN…":"Enter your 4-digit employee PIN")}</Text>
      <View style={s.keypad}>{keys.map((key,index)=>key?<TouchableOpacity accessibilityRole="button" accessibilityLabel={key==="⌫"?"Delete digit":`Digit ${key}`} disabled={busy} activeOpacity={.68} key={`${key}-${index}`} style={[s.key,key==="⌫"&&s.keyGhost]} onPress={()=>press(key)}><Text style={[s.keyText,key==="⌫"&&s.backspace]}>{key}</Text></TouchableOpacity>:<View key={`empty-${index}`} style={s.keyEmpty}/>)}</View>
      {onUsePassword?<TouchableOpacity style={s.password} onPress={onUsePassword} disabled={busy}><Text style={s.passwordText}>Use full password instead</Text></TouchableOpacity>:null}
    </View>
    <View style={s.footer}><Text style={s.footerTitle}>Your permissions stay yours.</Text><Text style={s.footerText}>This PIN unlocks only your own Ledgerly role on this trusted school device.</Text></View>
  </SafeAreaView>
}

const s=StyleSheet.create({
  root:{flex:1,backgroundColor:"#061b16",overflow:"hidden"},orb:{position:"absolute",width:330,height:330,borderRadius:165,opacity:.16},orbA:{backgroundColor:"#36d98e",right:-120,top:-90},orbB:{backgroundColor:"#3279f5",left:-160,bottom:-60},
  top:{height:74,paddingHorizontal:22,flexDirection:"row",alignItems:"center"},brandMark:{width:38,height:38,borderRadius:12,backgroundColor:"#24a86e",alignItems:"center",justifyContent:"center"},brandLetter:{color:"white",fontSize:20,fontWeight:"900"},brand:{marginLeft:10,color:"white",fontSize:20,fontWeight:"900",letterSpacing:-.5},secure:{marginLeft:"auto",flexDirection:"row",alignItems:"center",gap:6,paddingHorizontal:10,paddingVertical:7,borderRadius:20,backgroundColor:"rgba(78,221,151,.10)",borderWidth:1,borderColor:"rgba(98,235,166,.18)"},secureDot:{width:6,height:6,borderRadius:3,backgroundColor:"#56e8a5"},secureText:{color:"#9fd3bc",fontSize:9,fontWeight:"900",letterSpacing:.8},
  content:{flex:1,alignItems:"center",justifyContent:"center",paddingHorizontal:28,paddingBottom:8},lockHalo:{width:94,height:94,borderRadius:47,backgroundColor:"rgba(68,221,147,.10)",borderWidth:1,borderColor:"rgba(89,231,160,.20)",alignItems:"center",justifyContent:"center",marginBottom:18},lockBody:{width:42,height:48,alignItems:"center",justifyContent:"flex-end"},lockShackle:{position:"absolute",top:0,width:26,height:27,borderWidth:5,borderColor:"#62e3a6",borderBottomWidth:0,borderTopLeftRadius:15,borderTopRightRadius:15},lockSquare:{width:39,height:31,borderRadius:10,backgroundColor:"#61dfa4",alignItems:"center",justifyContent:"center"},keyhole:{width:6,height:11,borderRadius:3,backgroundColor:"#0c3b2a"},kicker:{color:"#5ee3a4",fontSize:10,fontWeight:"900",letterSpacing:1.7},heading:{color:"#fff",fontSize:31,fontWeight:"900",letterSpacing:-1,marginTop:7,textAlign:"center"},school:{color:"#a5c2b5",fontSize:14,fontWeight:"700",marginTop:7,textAlign:"center"},employee:{color:"#70d9a7",fontSize:12,fontWeight:"800",marginTop:4},
  pinRow:{flexDirection:"row",gap:15,marginTop:28},pinDot:{width:18,height:18,borderRadius:9,borderWidth:2,borderColor:"#517469",alignItems:"center",justifyContent:"center",backgroundColor:"rgba(255,255,255,.02)"},pinDotFilled:{borderColor:"#64e1a6",backgroundColor:"rgba(94,225,165,.12)"},pinInner:{width:8,height:8,borderRadius:4,backgroundColor:"#66e3a8"},helper:{height:38,color:"#809e91",fontSize:12,fontWeight:"700",marginTop:12,textAlign:"center",paddingHorizontal:12},error:{color:"#ff9d96"},
  keypad:{width:292,flexDirection:"row",flexWrap:"wrap",justifyContent:"space-between",rowGap:10,marginTop:2},key:{width:84,height:64,borderRadius:24,backgroundColor:"rgba(255,255,255,.065)",borderWidth:1,borderColor:"rgba(255,255,255,.08)",alignItems:"center",justifyContent:"center"},keyGhost:{backgroundColor:"transparent",borderColor:"transparent"},keyEmpty:{width:84,height:64},keyText:{color:"#f3fff9",fontSize:25,fontWeight:"700"},backspace:{fontSize:22,color:"#a7c7b8"},password:{marginTop:17,minHeight:42,paddingHorizontal:18,alignItems:"center",justifyContent:"center"},passwordText:{color:"#78cba5",fontSize:12,fontWeight:"900"},
  footer:{paddingHorizontal:28,paddingBottom:24,alignItems:"center"},footerTitle:{color:"#bbd4c8",fontSize:11,fontWeight:"900"},footerText:{color:"#68887a",fontSize:10.5,lineHeight:16,textAlign:"center",maxWidth:330,marginTop:3}
});
