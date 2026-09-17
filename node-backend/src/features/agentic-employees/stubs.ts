// Stand-ins for cross-module functions the original Cloudflare Worker's
// agentic-employees backend calls into (communications, tasks-work, printerly,
// academics timetable intelligence). Those modules have not been ported to
// node-backend yet. Preparing an action (writing to ae_actions/ae_approvals)
// still works fully; only the final execution step for these specific action
// types is unavailable until the corresponding module is ported.
import { AppError } from "../../http/errors.js";

const notPorted = (feature: string) => { throw new AppError(501, "NOT_IMPLEMENTED", `${feature} has not been ported to the self-hosted Node backend yet. The action was prepared and approved, but cannot be executed.`); };

export async function dispatchCampaign(..._args: any[]): Promise<any> { return notPorted("Communications dispatch"); }
export async function ensureBuiltinMessageTypes(..._args: any[]): Promise<any> { return notPorted("Communications message types"); }

export async function nextTaskNumber(..._args: any[]): Promise<any> { return notPorted("Tasks & Work"); }
export async function requireOrgUser(..._args: any[]): Promise<any> { return notPorted("Tasks & Work"); }

export async function stageGeneratedPdf(..._args: any[]): Promise<any> { return notPorted("Printerly document staging"); }
export async function submitGovernedPrintJob(..._args: any[]): Promise<any> { return notPorted("Printerly"); }
export const Printerly = new Proxy({}, { get() { return () => notPorted("Printerly"); } });

export async function generateDraft(..._args: any[]): Promise<any> { return notPorted("Timetable intelligence"); }
export async function lessonPeriodContext(..._args: any[]): Promise<any> { return notPorted("Timetable intelligence"); }
export async function listRules(..._args: any[]): Promise<any> { return notPorted("Timetable intelligence"); }
export async function matrix(..._args: any[]): Promise<any> { return notPorted("Timetable intelligence"); }
export async function validateTimetable(..._args: any[]): Promise<any> { return notPorted("Timetable intelligence"); }
export async function weekView(..._args: any[]): Promise<any> { return notPorted("Timetable intelligence"); }
export async function syncCurriculumLoadRules(..._args: any[]): Promise<any> { return notPorted("Timetable intelligence"); }
export async function reviewGeneratedDraft(..._args: any[]): Promise<any> { return notPorted("Timetable intelligence"); }
export async function recoveryOptions(..._args: any[]): Promise<any> { return notPorted("Timetable intelligence"); }
export async function substituteCandidates(..._args: any[]): Promise<any> { return notPorted("Timetable intelligence"); }
