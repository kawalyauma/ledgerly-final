import { Hono } from 'hono';
import { z } from 'zod';
import { AppError } from '../../http/errors.js';
import type { AppEnv } from '../../http/types.js';
import type { Runtime } from '../../runtime.js';
import { requireScope } from '../core-identity/security.js';
import {
  getReceiptPrintSettings,
  listReceiptPrintDispatches,
  retryReceiptPrintDispatch,
  updateReceiptPrintSettings,
} from './auto-receipts.js';

const settingsSchema=z.object({
  enabled:z.boolean().default(true),
  printerId:z.string().min(1).nullable().default(null),
  copies:z.number().int().min(1).max(10).default(1),
  pageSize:z.enum(['A4','A5','Letter','Legal']).default('A5'),
  autoChargeFinance:z.boolean().default(true),
});

export function createReceiptPrintingRoutes(runtime:Runtime){
  const r=new Hono<AppEnv>();
  r.use('*',requireScope('documents:read'));

  r.get('/receipt-printing/settings',async c=>{
    const p=c.get('principal');
    return c.json({data:await getReceiptPrintSettings(runtime,p.organizationId)});
  });

  r.put('/receipt-printing/settings',requireScope('documents:write'),async c=>{
    const parsed=settingsSchema.safeParse(await c.req.json().catch(()=>null));
    if(!parsed.success)throw new AppError(422,'VALIDATION_ERROR','Invalid automatic receipt printing settings',parsed.error.flatten());
    const p=c.get('principal');
    return c.json({data:await updateReceiptPrintSettings(runtime,p.organizationId,p.userId,parsed.data)});
  });

  r.get('/receipt-printing/dispatches',async c=>{
    const p=c.get('principal');
    const limit=Number(c.req.query('limit')??100);
    return c.json({data:await listReceiptPrintDispatches(runtime,p.organizationId,limit)});
  });

  r.post('/receipt-printing/dispatches/:paymentId/retry',requireScope('documents:write'),async c=>{
    const p=c.get('principal');
    return c.json({data:await retryReceiptPrintDispatch(runtime,p.organizationId,c.req.param('paymentId'))});
  });

  return r;
}
