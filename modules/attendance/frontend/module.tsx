import { CalendarCheck, Download, ScanFace, UserCheck, Users } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { AttendanceHome } from "./AttendanceHome";
import { QuickCheckInPage } from "./QuickCheckIn";
import "./attendance.css";
import "./professional.css";

const moduleDefinition:FrontendModuleDefinition={
  key:"attendance",name:"Attendance",version:"1.3.0",order:26,
  routes:{
    attendance:{scope:"school:read",view:AttendanceHome},
    "attendance-checkin":{scope:"school:read",view:QuickCheckInPage}
  },
  // Only what the self-hosted server provides (registers, staff timekeeping, reports). Live view, biometrics,
  // devices, corrections and configuration need the Cloudflare attendance API, which this server does not have.
  navigation:[{label:"Attendance",icon:ScanFace,order:26,items:[
    {label:"Quick check-in",path:"attendance-checkin",scope:"school:read",icon:UserCheck},
    {label:"Student attendance",path:"attendance/students",scope:"school:read",icon:CalendarCheck},
    {label:"Staff attendance",path:"attendance/staff",scope:"school:read",icon:Users},
    {label:"Reports",path:"attendance/reports",scope:"school:read",icon:Download}
  ]}]
};
export default moduleDefinition;
