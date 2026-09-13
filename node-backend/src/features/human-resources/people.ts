import { Hono } from "hono";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { requireScope } from "../core-identity/security.js";

export function createHumanResourcesPeopleRoutes(runtime:Runtime){
 const r=new Hono<AppEnv>();r.use("*",requireScope("hr:read"));
 r.get("/people",async c=>{
  const p=c.get("principal"),q=(c.req.query("q")??"").trim().toLowerCase(),unlinked=c.req.query("unlinkedOnly")==="true";
  const [contacts,staff,users,linked]=await Promise.all([
   runtime.db.query(`SELECT c.id,c.name,c.email,cp.phone FROM contacts c LEFT JOIN contact_people cp ON cp.organization_id=c.organization_id AND cp.contact_id=c.id AND cp.is_primary=true WHERE c.organization_id=$1 AND c.type='employee' AND c.active=true AND c.archived_at IS NULL ORDER BY c.name`,[p.organizationId]),
   runtime.db.query(`SELECT s.id,s.contact_id,s.user_id,s.staff_number,concat_ws(' ',s.first_name,s.middle_name,s.last_name) name,s.email,s.phone FROM school_staff_profiles s WHERE s.organization_id=$1 AND s.employment_status='active' AND s.deleted_at IS NULL ORDER BY s.last_name,s.first_name`,[p.organizationId]),
   runtime.db.query(`SELECT u.id,u.display_name name,u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1 AND u.status='active' ORDER BY u.display_name`,[p.organizationId]),
   runtime.db.query(`SELECT id,user_id,contact_id,school_staff_id FROM hr_employees WHERE organization_id=$1`,[p.organizationId])
  ]);
  const links=linked.rows as any[],people:any[]=[];
  for(const x of contacts.rows as any[])people.push({sourceModule:"contacts",sourceType:"employee_contact",sourceId:x.id,contactId:x.id,name:x.name,email:x.email??null,phone:x.phone??null});
  for(const x of staff.rows as any[])people.push({sourceModule:"school-management",sourceType:"school_staff",sourceId:x.id,schoolStaffId:x.id,contactId:x.contact_id??null,userId:x.user_id??null,code:x.staff_number,name:x.name,email:x.email??null,phone:x.phone??null});
  for(const x of users.rows as any[])people.push({sourceModule:"tasks-work",sourceType:"organization_user",sourceId:x.id,userId:x.id,name:x.name,email:x.email??null,phone:null});
  for(const person of people){const match=links.find(x=>(person.userId&&x.user_id===person.userId)||(person.contactId&&x.contact_id===person.contactId)||(person.schoolStaffId&&x.school_staff_id===person.schoolStaffId));person.hrEmployeeId=match?.id??null;}
  const deduped:Array<any>=[],seen=new Set<string>();for(const person of people){const key=person.hrEmployeeId?`hr:${person.hrEmployeeId}`:person.schoolStaffId?`staff:${person.schoolStaffId}`:person.contactId?`contact:${person.contactId}`:`user:${person.userId}`;if(seen.has(key))continue;seen.add(key);deduped.push(person);}
  const filtered=deduped.filter(person=>(!unlinked||!person.hrEmployeeId)&&(!q||[person.name,person.email,person.phone,person.code].some(v=>String(v??"").toLowerCase().includes(q))));
  return c.json({data:filtered});
 });
 return r;
}
