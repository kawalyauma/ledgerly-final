export type SupervisionFieldType =
  | "text" | "textarea" | "number" | "date" | "time" | "select" | "multi_select"
  | "teacher" | "class" | "subject" | "student" | "rubric" | "table";

export type SupervisionColumn = {
  id: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "teacher" | "class" | "subject" | "student";
  options?: string[];
  required?: boolean;
};

export type SupervisionField = {
  id: string;
  label: string;
  type: SupervisionFieldType;
  required?: boolean;
  helpText?: string;
  placeholder?: string;
  options?: string[];
  items?: string[];
  scale?: "compliance" | "rating4" | "rating5";
  columns?: SupervisionColumn[];
};

export type SupervisionSection = {
  id: string;
  title: string;
  description?: string;
  fields: SupervisionField[];
};

const rubric = (id: string, label: string, items: string[], scale: "compliance" | "rating4" | "rating5" = "compliance"): SupervisionField =>
  ({ id, label, type: "rubric", items, scale, required: true });

export const lmjsSupervisionTemplate: SupervisionSection[] = [
  {
    id: "details", title: "Supervision details", description: "Record who or what is being supervised. Complete the same template again for every teacher or visit.", fields: [
      { id: "teacher", label: "Teacher", type: "teacher", required: true },
      { id: "class", label: "Class / stream", type: "class" },
      { id: "subject", label: "Subject / learning area", type: "subject" },
      { id: "supervisor_name", label: "Supervisor name", type: "text", required: true },
      { id: "supervisor_role", label: "Supervisor role", type: "text" },
      { id: "visit_time", label: "Visit time", type: "time" },
      { id: "week", label: "Week", type: "text" },
      { id: "visit_type", label: "Visit type", type: "select", options: ["Routine", "Follow-up", "Support visit", "Other"], required: true },
    ],
  },
  {
    id: "academic_compliance", title: "Academic records and professional compliance", description: "C = Compliant, P = Partly compliant, NC = Not compliant, NA = Not applicable.", fields: [
      rubric("compliance", "Compliance checks", [
        "Scheme of work current and aligned to curriculum", "Lesson plans prepared and available", "Teaching progress recorded against scheme",
        "Class attendance register updated", "Teacher attendance and punctuality recorded", "Timetable followed; missed lessons addressed",
        "Assessment records and learner progress updated", "Learning materials and classroom readiness", "Learner welfare, inclusion and respectful conduct",
      ]),
      { id: "priority_concern", label: "Priority compliance concern / immediate support required", type: "textarea" },
    ],
  },
  {
    id: "lesson_observation", title: "Lesson planning and classroom practice", fields: [
      { id: "lesson_topic", label: "Lesson topic", type: "text" },
      { id: "learners_present", label: "Learners present", type: "number" },
      rubric("lesson_ratings", "Planning and lesson observation", [
        "Clear, suitable learning objectives", "Lesson plan links to scheme and prior learning", "Content accurate and appropriate to class level",
        "Activities and materials prepared", "Teaching methods engage learners actively", "Support for differing learning needs",
        "Clear explanations and learner questioning", "Checks understanding during the lesson", "Class management and respectful interaction",
        "Lesson pacing, summary and next steps",
      ], "rating4"),
      { id: "strengths", label: "Strengths observed", type: "textarea" },
      { id: "improvement_needed", label: "Improvement needed / agreed teaching support", type: "textarea" },
    ],
  },
  {
    id: "homework", title: "Homework, marking and learner follow-up", fields: [
      rubric("homework_checks", "Homework and assessment review", [
        "Homework aligns with taught content", "Tasks and due dates clearly communicated", "Workload is suitable for learner level",
        "Submission and non-completion followed up", "Exercise books / homework marked promptly", "Feedback clear; corrections checked",
        "Assessment outcomes inform reteaching", "Parent / guardian follow-up when needed",
      ]),
      { id: "learner_samples", label: "Learner work samples and support", type: "table", columns: [
        { id: "student", label: "Learner", type: "student" }, { id: "class", label: "Class", type: "class" },
        { id: "work", label: "Work / skill reviewed", type: "text" }, { id: "finding", label: "Finding / support needed", type: "textarea" },
      ] },
      { id: "books_sampled", label: "Books sampled", type: "number" },
      { id: "books_marked", label: "Marked", type: "number" },
      { id: "corrections_checked", label: "Corrections checked", type: "number" },
      { id: "learning_gaps", label: "Common learning gaps / planned remedial work", type: "textarea" },
    ],
  },
  {
    id: "progress", title: "Teacher progress and performance review", fields: [
      { id: "review_period", label: "Review period", type: "text" },
      { id: "curriculum_coverage", label: "Curriculum coverage and progress", type: "table", columns: [
        { id: "topic", label: "Topic / learning area", type: "text" }, { id: "planned", label: "Planned target / date", type: "text" },
        { id: "completed", label: "Completed / evidence", type: "textarea" }, { id: "gap", label: "Gap / catch-up date", type: "text" },
      ] },
      rubric("performance", "Performance and professional growth", [
        "Planning and curriculum delivery", "Learner progress and response to learning gaps", "Assessment, marking and record keeping",
        "Reliability and professional conduct", "Collaboration and communication", "Use of feedback and professional learning",
      ], "rating4"),
      { id: "teacher_reflection", label: "Teacher reflection: achievements, challenges and support needed", type: "textarea" },
      { id: "previous_action", label: "Previous agreed action", type: "text" },
      { id: "previous_action_status", label: "Previous action status", type: "select", options: ["Not started", "In progress", "Completed", "Carried forward"] },
    ],
  },
  {
    id: "actions", title: "Agreed actions and review sign-off", fields: [
      { id: "action_plan", label: "Improvement and support plan", type: "table", columns: [
        { id: "action", label: "Priority / agreed action", type: "textarea", required: true }, { id: "owner", label: "Responsible person", type: "text" },
        { id: "due", label: "Due date", type: "date" }, { id: "evidence", label: "Success evidence / review result", type: "textarea" },
      ] },
      { id: "next_review", label: "Next review date", type: "date" },
      { id: "reviewer", label: "Reviewer", type: "text" },
      { id: "school_support", label: "Support / resources to be provided by school leadership", type: "textarea" },
      { id: "overall_judgement", label: "Overall judgement", type: "select", options: ["Strong", "Meets expectations", "Needs improvement", "Urgent support"], required: true },
      { id: "summary_comments", label: "Supervisor summary / teacher comments", type: "textarea" },
      { id: "teacher_signoff", label: "Teacher name / acknowledgement", type: "text" },
      { id: "supervisor_signoff", label: "Supervisor name / acknowledgement", type: "text" },
      { id: "headteacher_signoff", label: "Head teacher / designate acknowledgement", type: "text" },
    ],
  },
];

export const supervisionFieldTypes: { value: SupervisionFieldType; label: string }[] = [
  { value: "text", label: "Short text" }, { value: "textarea", label: "Long text" }, { value: "number", label: "Number" },
  { value: "date", label: "Date" }, { value: "time", label: "Time" }, { value: "select", label: "Dropdown" },
  { value: "multi_select", label: "Multiple choice" }, { value: "teacher", label: "Teacher dropdown" },
  { value: "class", label: "Class dropdown" }, { value: "subject", label: "Subject dropdown" },
  { value: "student", label: "Student dropdown" }, { value: "rubric", label: "Rating / compliance table" },
  { value: "table", label: "Repeating table" },
];
