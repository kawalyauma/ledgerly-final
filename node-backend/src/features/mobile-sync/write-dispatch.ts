import { AppError } from "../../http/errors.js";
import type { AuthPrincipal } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { queueDocumentIntent, queueJournalIntent } from "../finance-mobile/intents.js";
import { queueHrLeaveIntent, queueHrOnboardingCompletionIntent } from "../human-resources/mobile-intents.js";

export async function queueMobileWrite(runtime:Runtime,principal:AuthPrincipal,input:{moduleKey:string;collectionKey:string;recordId:string;deviceId:string;clientTimestamp:string;payload:unknown}){
  const shared={id:input.recordId,organizationId:principal.organizationId,userId:principal.userId,deviceId:input.deviceId,clientTimestamp:input.clientTimestamp,role:principal.role,payload:input.payload};
  if(input.moduleKey==="ledgerly-core"&&input.collectionKey==="document-intents"){
    const data=await queueDocumentIntent(runtime,principal.organizationId,principal.userId,{id:input.recordId,deviceId:input.deviceId,clientTimestamp:input.clientTimestamp,payload:input.payload});
    await runtime.queue.publish("finance-mobile.intents",{},{queue:"finance-mobile",maxAttempts:3}).catch(()=>undefined);
    return data;
  }
  if(input.moduleKey==="ledgerly-core"&&input.collectionKey==="journal-intents"){
    const data=await queueJournalIntent(runtime,principal.organizationId,principal.userId,{id:input.recordId,deviceId:input.deviceId,clientTimestamp:input.clientTimestamp,payload:input.payload});
    await runtime.queue.publish("finance-mobile.intents",{},{queue:"finance-mobile",maxAttempts:3}).catch(()=>undefined);
    return data;
  }
  if(input.moduleKey==="human-resources"&&input.collectionKey==="leave-request-intents"){
    const data=await queueHrLeaveIntent(runtime,shared);
    await runtime.queue.publish("hr-mobile.intents",{},{queue:"hr-mobile",maxAttempts:3}).catch(()=>undefined);
    return data;
  }
  if(input.moduleKey==="human-resources"&&input.collectionKey==="onboarding-completion-intents"){
    const data=await queueHrOnboardingCompletionIntent(runtime,shared);
    await runtime.queue.publish("hr-mobile.intents",{},{queue:"hr-mobile",maxAttempts:3}).catch(()=>undefined);
    return data;
  }
  throw new AppError(409,"READ_ONLY_COLLECTION","Collection is not writable");
}
