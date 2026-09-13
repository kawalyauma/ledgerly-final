import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { createId, requireScope } from "../core-identity/security.js";

const employeeCreate=z.object({
  userId:z.string().nullable().optional(),contactId:z.string().nullable().optional(),schoolStaffId:z.string().nullable().optional(),departmentId:z.string().nullable().optional(),employeeNumber:z.string().min(1).max(40),jobTitle:z.string().max(120).nullable().optional(),employmentType:z.enum(["permanent","contract","part_time","casual","intern","volunteer"]).default("permanent"),employmentStatus:z.enum(["active","on_leave","suspended","terminated","resigned","retired","inactive"]).default("active"),hireDate:z.string(),terminationDate:z.string().nullable().optional(),managerEmployeeId:z.string().nullable().optional(),workEmail:z.string().email().nullable().optional(),workPhone:z.string().max(60).nullable().optional(),metadata:z.record(z.string(),z.unknown()).default({})
}).refine(v=>Boolean(v.userId||v.contactId||v.schoolStaffId),{message:"Link this employee to a user, contact, or school staff profile"});

const employeePatch=z.object({departmentId:z.string().nullable().optional(),jobTitle:z.string().max(120).nullable().optional(),employmentType:z.enum(["permanent","contract","part_time","casual","intern","volunteer"]).optional(),employmentStatus:z.enum(["active","on_leave","suspended","terminated","resigned","retired","inactive"]).optional(),hireDate:z.string().optional(),terminationDate:z.string().nullable().optional(),managerEmployeeId:z.string().nullable().optional(),workEmail:z.string().email().nullable().optional(),workPhone:z.string().max(60).nullable().optional()});
const onboarding=z.object({employeeId:z.string().min(1),title:z.string().min(1).max(240),dueDate:z.string().nullable().optional(),assignedUserId:z.string().nullable().optional()});

async function owned(runtime:Runtime,org:string,table:string,id?:string|null){if(!id)return;const q=await runtime.db.query(`SELECT 1 FROM ${table} WHERE id=$1 AND organization_id=$2`,[id,org]);if(!q.rowCount)throw new AppError(422,"INVALID_REFERENCE",`Referenced ${table} record does not belong to this organization`);}
async function member(runtime:Runtime,org:string,userId?:string|null){if(!userId)return;const q=await runtime.db.query(`SELECT 1 FROM memberships WHERE organization_id=$1 AND user_id=$2`,[org,userId]);if(!q.rowCount)throw new AppError(422,"INVALID_USER","User does not belong to this organization");}

export function createHumanResourcesIntegrityRoutes(runtime:Runtime){
  const r=new Hono<AppEnv>();r.use("*",requireScope("hr:read"));

  r.post("/employees",requireScope("hr:write"),async c=>{
    const s=employeeCreate.safeParse(await c.req.json().catch(()=>null));if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid employment record",s.error.flatten());
    const p=c.get("principal"),v=s.data;
    await member(runtime,p.organizationId,v.userId);await owned(runtime,p.organizationId,"contacts",v.contactId);await owned(runtime,p.organizationId,"school_staff_profiles",v.schoolStaffId);await owned(runtime,p.organizationId,"hr_departments",v.departmentId);await owned(runtime,p.organizationId,"hr_employees",v.managerEmployeeId);
    if(v.schoolStaffId&&v.userId){const q=await runtime.db.query(`SELECT user_id FROM school_staff_profiles WHERE id=$1 AND organization_id=$2`,[v.schoolStaffId,p.organizationId]);const linked=(q.rows[0] as any)?.user_id;if(linked&&linked!==v.userId)throw new AppError(409,"IDENTITY_MISMATCH","School staff profile is linked to a different user");}
    const id=createId("hre");
    await runtime.db.query(`INSERT INTO hr_employees(id,organization_id,user_id,contact_id,school_staff_id,department_id,employee_number,job_title,employment_type,employment_status,hire_date,termination_date,manager_employee_id,work_email,work_phone,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)`,[id,p.organizationId,v.userId??null,v.contactId??null,v.schoolStaffId??null,v.departmentId??null,v.employeeNumber,v.jobTitle??null,v.employmentType,v.employmentStatus,v.hireDate,v.terminationDate??null,v.managerEmployeeId??null,v.workEmail??null,v.workPhone??null,JSON.stringify(v.metadata)]);
    return c.json({data:{id,...v}},201);
  });

  r.patch("/employees/:id",requireScope("hr:write"),async c=>{
    const s=employeePatch.safeParse(await c.req.json().catch(()=>null));if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid employee changes",s.error.flatten());const p=c.get("principal"),v=s.data,id=c.req.param("id");if(!Object.keys(v).length)throw new AppError(422,"VALIDATION_ERROR","No editable fields supplied");
    await owned(runtime,p.organizationId,"hr_employees",id);await owned(runtime,p.organizationId,"hr_departments",v.departmentId);await owned(runtime,p.organizationId,"hr_employees",v.managerEmployeeId);if(v.managerEmployeeId===id)throw new AppError(422,"INVALID_MANAGER","Employee cannot manage themselves");
    const map:Record<string,string>={departmentId:"department_id",jobTitle:"job_title",employmentType:"employment_type",employmentStatus:"employment_status",hireDate:"hire_date",terminationDate:"termination_date",managerEmployeeId:"manager_employee_id",workEmail:"work_email",workPhone:"work_phone"};const entries=Object.entries(v),vals=entries.map(([,x])=>x??null),sets=entries.map(([k],i)=>`${map[k]}=$${i+1}`);vals.push(id,p.organizationId);
    const q=await runtime.db.query(`UPDATE hr_employees SET ${sets.join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=$${vals.length-1} AND organization_id=$${vals.length} RETURNING *`,vals);return c.json({data:q.rows[0]});
  });

  r.post("/onboarding",requireScope("hr:write"),async c=>{
    const s=onboarding.safeParse(await c.req.json().catch(()=>null));if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid onboarding task",s.error.flatten());const p=c.get("principal"),v=s.data;await owned(runtime,p.organizationId,"hr_employees",v.employeeId);await member(runtime,p.organizationId,v.assignedUserId);const id=createId("hot");await runtime.db.query(`INSERT INTO hr_onboarding_tasks(id,organization_id,employee_id,title,due_date,assigned_user_id) VALUES($1,$2,$3,$4,$5,$6)`,[id,p.organizationId,v.employeeId,v.title,v.dueDate??null,v.assignedUserId??null]);return c.json({data:{id,status:"pending",...v}},201);
  });
  return r;
}
