import { BarChart3, CalendarCheck, Download, History, MonitorSmartphone, ScanFace, Settings2, ShieldCheck, Users } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { AttendanceHome } from "./AttendanceHome";
import { DevicesPage } from "./DevicesPage";
import "./attendance.css";
import "./professional.css";

const moduleDefinition:FrontendModuleDefinition={
  key:"attendance",name:"Attendance",version:"1.3.0",order:26,
  routes:{
    attendance:{scope:"school:read",view:AttendanceHome},
    "attendance-kiosks":{scope:"school:read",view:DevicesPage}
  },
  navigation:[{label:"Attendance",icon:ScanFace,order:26,items:[
    {label:"Dashboard",path:"attendance",scope:"school:read",icon:BarChart3},
    {label:"Live attendance",path:"attendance/live",scope:"school:read",icon:ScanFace},
    {label:"Student attendance",path:"attendance/students",scope:"school:read",icon:CalendarCheck},
    {label:"Staff attendance",path:"attendance/staff",scope:"school:read",icon:Users},
    {label:"Biometrics",path:"attendance/biometrics",scope:"school:read",icon:ShieldCheck},
    {label:"Devices & kiosks",path:"attendance-kiosks",scope:"school:read",icon:MonitorSmartphone},
    {label:"Corrections & exceptions",path:"attendance/operations",scope:"school:read",icon:History},
    {label:"Reports",path:"attendance/reports",scope:"school:read",icon:Download},
    {label:"Configuration",path:"attendance/configuration",scope:"school:read",icon:Settings2}
  ]}]
};
export default moduleDefinition;
