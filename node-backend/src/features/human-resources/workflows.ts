import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { requireScope } from "../core-identity/security.js";

const statusSchema=z.object({status:z.enum(["pending","completed"])});
const departmentPatch=z.object({code:z.string().trim().min(1).max(40).optional(),name:z.string().trim().min(1).max(120).optional(),managerEmployeeId:z.string().nullable().optional(),active:z.boolean().optional()});
const leaveTypePatch=z.object({code:z.string().trim().min(1).max(40).optional(),name:z.string().trim().min(1).max(120).optional(),paid:z.boolean().optional(),annualDays:z.number().min(0).max(366).optional(),active:z.boolean().optional()});
const reviewSchema=z.object({decision:z.enum(["approve","reject"]),notes:z.string().max(1000).optional().nullable()});

async function ensureEmployee(runtime:Runtime,organizationId:string,id?:string|null){if(!id)return;const q=await runtime.db.query(`SELECT 1 FROM hr_employees WHERE id=$1 AND organization_id=$2`,[id,organizationId]);if(!q.rowCount)throw new AppError(422,"INVALID_EMPLOYEE","Employee must belong to this organization");}

export function createHumanResourcesWorkflowRoutes(runtime:Runtime){
 const r=new Hono<AppEnv>();
 r.use("*",requireScope("hr:read"));

 r.patch("/onboarding/:id/status",requireScope("hr:write"),async c=>{const parsed=statusSchema.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid onboarding status",parsed.error.flatten());const p=c.get("principal"),id=c.req.param("id"),status=parsed.data.status;const q=await runtime.db.query(`UPDATE hr_onboarding_tasks SET status=$1,completed_at=CASE WHEN $1='completed' THEN COALESCE(completed_at,CURRENT_TIMESTAMP) ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3 RETURNING *`,[status,id,p.organizationId]);if(!q.rowCount)throw new AppError(404,"NOT_FOUND","Onboarding task not found");return c.json({data:q.rows[0]});});

 r.patch("/departments/:id",requireScope("hr:write"),async c=>{const parsed=departmentPatch.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid department changes",parsed.error.flatten());const entries=Object.entries(parsed.data);if(!entries.length)throw new AppError(422,"VALIDATION_ERROR","No department changes supplied");const p=c.get("principal"),id=c.req.param("id");await ensureEmployee(runtime,p.organizationId,parsed.data.managerEmployeeId);const map:Record<string,string>={code:"code",name:"name",managerEmployeeId:"manager_employee_id",active:"active"},values=entries.map(([,v])=>v??null),sets=entries.map(([k],i)=>`${map[k]}=$${i+1}`);values.push(id,p.organizationId);const q=await runtime.db.query(`UPDATE hr_departments SET ${sets.join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=$${values.length-1} AND organization_id=$${values.length} RETURNING *`,values);if(!q.rowCount)throw new AppError(404,"NOT_FOUND","HR department not found");return c.json({data:q.rows[0]});});

 r.patch("/leave-types/:id",requireScope("hr:write"),async c=>{const parsed=leaveTypePatch.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid leave type changes",parsed.error.flatten());const entries=Object.entries(parsed.data);if(!entries.length)throw new AppError(422,"VALIDATION_ERROR","No leave type changes supplied");const p=c.get("principal"),id=c.req.param("id"),map:Record<string,string>={code:"code",name:"name",paid:"paid",annualDays:"annual_days"},values=entries.map(([,v])=>v??null),sets=entries.map(([k],i)=>`${map[k]}=$${i+1}`);values.push(id,p.organizationId);const q=await runtime.db.query(`UPDATE hr_leave_types SET ${sets.join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=$${values.length-1} AND organization_id=$${values.length} RETURNING *`,values);if(!q.rowCount)throw new AppError(404,"NOT_FOUND","Leave type not found");return c.json({data:q.rows[0]});});

 r.post("/leave-requests/:id/review",requireScope("hr:write"),async c=>{const parsed=reviewSchema.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid leave review",parsed.error.flatten());const p=c.get("principal"),id=c.req.param("id"),status=parsed.data.decision==="approve"?"approved":"rejected";const q=await runtime.db.query(`UPDATE hr_leave_requests SET status=$1,reviewed_by=$2,reviewed_at=CURRENT_TIMESTAMP,review_notes=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$4 AND organization_id=$5 AND status='pending' RETURNING *`,[status,p.userId,parsed.data.notes??null,id,p.organizationId]);if(!q.rowCount)throw new AppError(409,"INVALID_STATE","Pending leave request not found");return c.json({data:q.rows[0]});});

 r.get("/audit",async c=>{const p=c.get("principal"),limit=Math.min(200,Math.max(1,Number(c.req.query("limit"))||50));const q=await runtime.db.query(`SELECT id,action,entity_type,entity_id,actor_id,after,created_at FROM audit_logs WHERE organization_id=$1 AND (action LIKE 'hr.%' OR entity_type LIKE 'hr_%') ORDER BY created_at DESC LIMIT $2`,[p.organizationId,limit]);return c.json({data:q.rows});});
 return r;
}
