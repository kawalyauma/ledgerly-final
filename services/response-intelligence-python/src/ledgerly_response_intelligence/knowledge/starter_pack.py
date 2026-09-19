from __future__ import annotations

from .models import KnowledgeSourceCreate


def starter_analysis_pack(organization_id:str="")->list[KnowledgeSourceCreate]:
    """General analytical methodology, not local policy or student facts."""
    entries=[
        (
            "Chronic absenteeism analysis",
            ["attendance","learners","risk"],
            """Chronic absenteeism should be analysed as a pattern across time, not as a single absence count. Compare attendance rate, marked sessions, consecutive absences, day-of-week concentration, term-to-term change and class baseline where available. Separate verified attendance facts from possible contributors. Low attendance can coincide with weaker attainment, but attendance alone does not prove why a learner performed poorly. Useful follow-up evidence may include timetable exposure, assessment participation, medical or approved-leave records, transport interruptions and documented guardian communications. Prioritise learners with persistent patterns, recent deterioration or combinations of absence and academic decline."""
        ),
        (
            "Fees payment and arrears analysis",
            ["fees","finance","learners"],
            """Analyse school-fee position using billed, paid and outstanding balances, payment timing and period comparisons. Distinguish current balance from historical arrears and avoid treating an unpaid balance as evidence of parental unwillingness or learner behaviour. Useful segmentation includes fully paid, partially paid, overdue, rapidly improving and worsening balances. Where academic or attendance outcomes are compared with fee status, describe only observed associations unless verified records show an operational interruption caused by non-payment."""
        ),
        (
            "Lesson delivery and syllabus coverage",
            ["academics","lesson-delivery","teachers"],
            """Lesson delivery analysis should compare planned lessons, delivered lessons, missed lessons, syllabus or scheme coverage and the timing of missed instructional exposure. Examine subject, class, teacher and period patterns. A delivery gap can be a plausible contributor to weak outcomes when the affected content, period and assessment align, but the evidence should not automatically blame a teacher. Consider timetable changes, approved leave, school events, substitutions, learner attendance and whether recovery lessons were documented."""
        ),
        (
            "Academic performance trend analysis",
            ["academics","performance","assessment"],
            """Performance analysis should compare current and prior results using the same learner, subject and reasonably comparable assessment context. Look beyond total average: inspect subject-specific movement, consistency, aggregate or division changes, class baseline and distribution where available. Separate a broad decline from one-subject deterioration. Avoid claiming causation from attendance, fees, teacher records or discipline unless the records establish a credible sequence and linkage. Strong explanations identify the largest verified changes, relevant counter-evidence and what evidence is still missing."""
        ),
        (
            "Teacher attendance and instructional continuity",
            ["staff","attendance","teachers"],
            """Teacher attendance analysis should distinguish approved leave, lateness, absence, timetable obligations and actual instructional disruption. A staff absence has different educational significance depending on whether lessons were substituted or recovered. Compare patterns by period and workload rather than ranking teachers from raw absence counts alone. When connecting staff attendance with learner outcomes, require matching subject/class/time exposure and retain alternative explanations."""
        ),
        (
            "Assessment participation and missing work",
            ["assessment","academics","learners"],
            """Assessment analysis should distinguish low marks from missing assessments, incomplete scripts, absent learners and genuinely attempted work. A falling average may be distorted by missing or zero-scored components. Review participation rate, subject-level marks, assignment completion, comparable prior assessments and data completeness before interpreting performance. State explicitly when missing assessment evidence prevents a reliable conclusion."""
        ),
        (
            "Class and stream comparison",
            ["academics","classes","comparison"],
            """Class or stream comparison should normalise for the period, assessment, subjects offered and learner count before drawing conclusions. Compare distributions and medians where possible rather than relying only on top-line averages. Flag unequal data completeness, different assessment participation or materially different attendance exposure. A difference between streams is an observed outcome, not proof that one teacher, stream or group is inherently better."""
        ),
        (
            "Learner risk synthesis",
            ["learners","risk","analysis"],
            """A learner risk synthesis should combine only verified dimensions such as attendance, academic trend, fee balance, discipline events, assessment participation and documented support actions. Keep each dimension separately visible, then identify combinations that may require attention. Do not turn administrative risk flags into diagnoses or moral judgments. Strong reports distinguish urgent operational follow-up from uncertain explanatory hypotheses."""
        ),
        (
            "Parent and guardian engagement",
            ["guardians","communications","learners"],
            """Guardian-engagement analysis should use recorded contacts, meeting attendance, acknowledged notices and documented follow-up rather than assumptions about family involvement. Compare communication attempts with actual responses and outcomes. Lack of a recorded response may mean missing data, not deliberate disengagement. Where engagement is discussed alongside attendance or fees, describe temporal relationships without assigning blame."""
        ),
        (
            "Discipline and behaviour records",
            ["discipline","learners","safeguarding"],
            """Discipline analysis should use documented events, categories, dates, recurrence and completed interventions. Avoid labels that define a learner by incidents. Compare behaviour events with attendance or performance only when periods align, and do not infer mental state or home circumstances. Serious safeguarding concerns require the school's safeguarding process rather than speculative explanation in an analytical report."""
        ),
        (
            "Timetable and learning exposure",
            ["timetable","academics","lesson-delivery"],
            """Timetable analysis should measure scheduled instructional opportunity and identify clashes, under-allocation, repeated late-day concentration, teacher conflicts and unfilled slots. When studying performance, calculate actual exposure where delivery and attendance records exist rather than assuming every scheduled lesson occurred. Timetable structure can indicate a plausible operational constraint but does not independently establish academic causation."""
        ),
        (
            "Subject performance diagnosis",
            ["subjects","academics","analysis"],
            """Subject diagnosis should identify topic or assessment-component weaknesses where data permits, compare the learner with their own prior performance and relevant class distribution, and examine attendance or lesson exposure during the matching instructional period. Avoid generic statements such as 'the learner is weak'. State the measured gap, its timing and whether the available evidence supports an explanation or only identifies where further investigation is needed."""
        ),
        (
            "Teacher workload analysis",
            ["staff","workload","timetable"],
            """Teacher workload should consider teaching periods, number of preparations, class size, non-teaching duties, substitutions and timetable spread. Raw period counts alone may hide difficult scheduling or multiple subject preparations. Use workload analysis to identify operational pressure and allocation imbalance, not to infer teacher competence. Connect workload to delivery outcomes only where matching records show a credible pattern."""
        ),
        (
            "School cash collection trend",
            ["finance","fees","cashflow"],
            """Cash-collection analysis should compare billing, collections, outstanding receivables and timing by period. Separate accounting revenue from cash received. Identify concentration risk, overdue balances and collection momentum without treating future collections as certain. Where operational decisions depend on cash availability, state the data-as-of date and distinguish receivables from usable cash."""
        ),
        (
            "Budget versus actual analysis",
            ["finance","budget","management"],
            """Budget analysis should compare planned and actual values on the same period and accounting basis. Explain material variance using verified transactions, timing differences or documented operational changes. A favourable variance is not automatically good if essential activity was delayed; an unfavourable variance is not automatically poor control if justified activity increased. Highlight utilisation, concentration and unverified explanations separately."""
        ),
        (
            "Books and learning-material availability",
            ["books","inventory","academics"],
            """Learning-material analysis should compare required, available, issued, unissued, lost or damaged quantities with learner demand. Ratios should be tied to class/subject and period. When relating book availability to academic performance, material scarcity may be a plausible contributor but requires matching subject and timing evidence. Also consider whether available books were actually issued and used."""
        ),
        (
            "Enrollment, transfer and retention",
            ["students","enrollment","retention"],
            """Enrollment analysis should separate new admission, transfer, withdrawal, completion and inactive records. Retention requires a clearly defined cohort and time window. Do not interpret movement as dissatisfaction without recorded reasons. Compare classes, terms and demographic groups only when data coverage is adequate and privacy rules allow the comparison."""
        ),
        (
            "Staffing gaps and subject coverage",
            ["staff","subjects","coverage"],
            """Staffing analysis should map active staff qualifications/assignments against required subjects, classes and timetable demand. Distinguish a vacant position from a temporary absence or allocation gap. When explaining instructional problems, verify whether the affected lessons actually lacked qualified coverage and whether substitution or redistribution occurred."""
        ),
        (
            "Operational exception reporting",
            ["management","exceptions","risk"],
            """An operational exception report should focus attention on material deviations from expected operation: persistent absence, unusually high balances, missed delivery, unfilled timetable slots, overdue tasks, stock shortages or unresolved approvals. Each exception should state the rule or baseline used, current evidence, severity indicators and a practical follow-up. Exceptions should not be presented as proven causes of unrelated outcomes."""
        ),
        (
            "Evidence-based account-for reports",
            ["explanation","causality","analysis"],
            """An 'account for' report should begin with the outcome to be explained, establish a comparable baseline, identify the strongest verified changes, test plausible contributors against matching evidence, preserve counter-evidence and list unavailable evidence. Use language such as 'associated with', 'consistent with' or 'plausible contributor' unless a causal sequence is genuinely documented. Never fill missing evidence with a stereotyped explanation."""
        ),
        (
            "Management recommendation quality",
            ["recommendations","management","analysis"],
            """Recommendations should follow from the evidence, specify the operational objective and remain proportionate to confidence. Prefer actions that collect missing evidence, address reversible operational gaps and assign review points. Avoid recommendations that assume an unproven cause. Separate immediate safeguarding or compliance actions from longer-term improvement experiments."""
        ),
        (
            "Data quality and missing evidence",
            ["data-quality","analysis","audit"],
            """Before strong conclusions, inspect missing records, unmatched identifiers, incomplete periods, inconsistent definitions and different denominators. Report missingness when it could change the interpretation. Do not silently treat missing values as zero. If evidence from two modules cannot be safely joined by a stable entity identifier, keep the datasets separate rather than merging people by name alone."""
        ),
        (
            "Trend versus one-off event",
            ["trend","analysis","comparison"],
            """A trend requires multiple comparable observations across time. Two points can establish a change but not a stable trend. Distinguish one-off events, recent deterioration, sustained direction and seasonal patterns. Use the same metric definition and comparable period length. Avoid projecting future outcomes from a short sequence without an explicit forecasting method."""
        ),
        (
            "Correlation and causal caution",
            ["causality","analysis","statistics"],
            """When two school variables move together, report an association unless the evidence establishes timing, mechanism and plausible alternatives. Attendance, fees, lesson delivery, discipline and achievement often share other influences. A useful analysis quantifies the relationship, identifies the matching period/population, tests counter-examples where possible and states what additional evidence would strengthen or weaken a causal interpretation."""
        ),
    ]
    return [
        KnowledgeSourceCreate(
            organization_id=organization_id,
            title=title,
            source_type="research",
            content=content,
            approved=True,
            tags=tags+["ledgerly-starter-pack","analysis-method"],
            metadata={"pack":"ledgerly-school-analysis-v1","generalMethodology":True},
        )
        for title,tags,content in entries
    ]
