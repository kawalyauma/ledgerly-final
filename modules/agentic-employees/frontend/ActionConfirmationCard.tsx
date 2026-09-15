import {
  BookOpen,
  CalendarDays,
  FileText,
  GraduationCap,
  MessageSquare,
  Printer,
  ReceiptText,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";

export type InlineConfirmation = {
  source: "action" | "approval";
  id: string;
  eventId?: string | null;
  conversationId?: string | null;
  agentKey: string;
  actionType: string;
  title: string;
  summary: string;
  requiredScope: string;
  status: string;
  payload: Record<string, unknown>;
  createdAt?: string;
};

type Kind =
  | "staff"
  | "student"
  | "fees"
  | "timetable"
  | "communication"
  | "document"
  | "print"
  | "task"
  | "books"
  | "generic";

function words(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._/-]+/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

function text(value: unknown) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function classify(item: InlineConfirmation): Kind {
  const payload = item.payload || {};
  const path = String(payload.path || "");
  const body = payload.body || {};
  const haystack = [
    item.actionType,
    item.title,
    item.summary,
    path,
    JSON.stringify(body).slice(0, 2000),
  ].join(" ").toLowerCase();

  if (
    haystack.includes("teacher") ||
    haystack.includes("staff") ||
    haystack.includes("employee") ||
    haystack.includes("/hr/")
  ) return "staff";

  if (
    haystack.includes("student") ||
    haystack.includes("learner") ||
    haystack.includes("admission")
  ) return "student";

  if (
    haystack.includes("fee") ||
    haystack.includes("charge") ||
    haystack.includes("billing") ||
    haystack.includes("invoice")
  ) return "fees";

  if (
    haystack.includes("timetable") ||
    haystack.includes("period") ||
    haystack.includes("schedule")
  ) return "timetable";

  if (
    item.actionType === "communication.campaign.send" ||
    haystack.includes("sms") ||
    haystack.includes("whatsapp")
  ) return "communication";

  if (item.actionType === "document.generate") return "document";
  if (item.actionType === "printerly.document.print") return "print";
  if (item.actionType === "work.task.create") return "task";

  if (
    haystack.includes("book") ||
    haystack.includes("library")
  ) return "books";

  return "generic";
}

function icon(kind: Kind) {
  const icons: Record<Kind, ReactNode> = {
    staff: <Users size={20}/>,
    student: <UserPlus size={20}/>,
    fees: <ReceiptText size={20}/>,
    timetable: <CalendarDays size={20}/>,
    communication: <MessageSquare size={20}/>,
    document: <FileText size={20}/>,
    print: <Printer size={20}/>,
    task: <ShieldCheck size={20}/>,
    books: <BookOpen size={20}/>,
    generic: <GraduationCap size={20}/>,
  };

  return icons[kind];
}

function confirmLabel(kind: Kind, item: InlineConfirmation) {
  if (item.actionType === "system.api.workflow") {
    const context =
      `${item.title} ${item.summary}`.toLowerCase();

    if (
      context.includes("staff") ||
      context.includes("teacher") ||
      context.includes("onboard") ||
      context.includes("scheme") ||
      context.includes("subject")
    ) return "Confirm & Complete Setup";

    if (
      context.includes("fee") ||
      context.includes("charge") ||
      context.includes("billing")
    ) return "Confirm & Apply Charges";

    if (
      context.includes("timetable") ||
      context.includes("schedule")
    ) return "Confirm & Apply Timetable";

    return "Confirm & Execute Workflow";
  }

  const method = String(item.payload?.method || "").toUpperCase();
  const create = method === "POST";

  switch (kind) {
    case "staff":
      return create
        ? "Confirm & Create Staff"
        : "Confirm & Save Staff";
    case "student":
      return create
        ? "Confirm & Create Student"
        : "Confirm & Save Student";
    case "fees":
      return "Confirm & Apply Charges";
    case "timetable":
      return "Confirm & Apply Timetable";
    case "communication":
      return "Confirm & Send";
    case "document":
      return "Confirm & Generate";
    case "print":
      return "Confirm & Print";
    case "task":
      return "Confirm & Create Task";
    case "books":
      return "Confirm & Update Books";
    default:
      return "Confirm & Execute";
  }
}

function fallbackPrompt(kind: Kind) {
  switch (kind) {
    case "staff":
      return "Review the staff details below before the HR record is created or changed.";
    case "student":
      return "Review the learner details below before the student record is created or changed.";
    case "fees":
      return "Review the fee amounts, affected learners and billing details before charges are applied.";
    case "timetable":
      return "Review the proposed timetable change before it is applied.";
    case "communication":
      return "Review the recipients, channels and exact message before it is sent.";
    case "document":
      return "Review the document request before Ledgerly generates and saves it.";
    case "print":
      return "Review the document and printer settings before printing.";
    case "task":
      return "Review the task details before it is created.";
    case "books":
      return "Review the book or library changes before Ledgerly applies them.";
    default:
      return "Review the exact proposed Ledgerly change before it is executed.";
  }
}

function usefulPayload(item: InlineConfirmation): unknown {
  if (item.actionType === "system.api.request") {
    return item.payload?.body || {};
  }

  return item.payload || {};
}

function RenderValue({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}) {
  if (depth > 4) {
    return <span>{text(value)}</span>;
  }

  if (Array.isArray(value)) {
    if (!value.length) return <span>None</span>;

    if (value.every(v =>
      v === null ||
      ["string", "number", "boolean"].includes(typeof v)
    )) {
      return (
        <div className="ae-confirm-chips">
          {value.slice(0, 30).map((item, index) =>
            <span key={index}>{text(item)}</span>
          )}
          {value.length > 30 &&
            <span>+{value.length - 30} more</span>}
        </div>
      );
    }

    return (
      <div className="ae-confirm-groups">
        {value.slice(0, 20).map((item, index) =>
          <div className="ae-confirm-group" key={index}>
            <b>Item {index + 1}</b>
            <RenderValue value={item} depth={depth + 1}/>
          </div>
        )}
        {value.length > 20 &&
          <small>+ {value.length - 20} additional items</small>}
      </div>
    );
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(
      value as Record<string, unknown>,
    );

    if (!entries.length) return <span>None</span>;

    return (
      <div className="ae-confirm-fields">
        {entries.map(([key, child]) =>
          <div className="ae-confirm-field" key={key}>
            <span>{words(key)}</span>
            <div>
              <RenderValue
                value={child}
                depth={depth + 1}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  const rendered = text(value);

  return (
    <span className="ae-confirm-value">
      {rendered.length > 1000
        ? `${rendered.slice(0, 1000)}…`
        : rendered}
    </span>
  );
}

export function ActionConfirmationCard({
  item,
  busy,
  onConfirm,
  onCancel,
}: {
  item: InlineConfirmation;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const kind = classify(item);
  const method = String(item.payload?.method || "");
  const path = String(item.payload?.path || "");

  return (
    <article className={`ae-confirm-card ae-confirm-${kind}`}>
      <div className="ae-confirm-head">
        <div className="ae-confirm-icon">
          {icon(kind)}
        </div>

        <div>
          <span>CONFIRM BEFORE LEDGERLY CHANGES DATA</span>
          <h3>{item.title || "Confirm prepared action"}</h3>
          <p>{item.summary || fallbackPrompt(kind)}</p>
        </div>
      </div>

      <div className="ae-confirm-preview">
        <RenderValue value={usefulPayload(item)}/>
      </div>

      {(method || path) && (
        <details className="ae-confirm-technical">
          <summary>Technical details</summary>
          {method && <div><b>Method:</b> {method}</div>}
          {path && <div><b>Route:</b> {path}</div>}
          <div><b>Permission:</b> {item.requiredScope}</div>
        </details>
      )}

      <div className="ae-confirm-footer">
        <button
          className="secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>

        <button
          disabled={busy}
          onClick={onConfirm}
        >
          <ShieldCheck size={16}/>
          {confirmLabel(kind, item)}
        </button>
      </div>
    </article>
  );
}
