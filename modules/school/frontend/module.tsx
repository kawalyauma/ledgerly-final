import { BarChart3, BriefcaseBusiness, CircleDollarSign, ClipboardCheck, FileSpreadsheet, Gavel, GraduationCap, KeyRound, LayoutDashboard, Monitor, School, Settings2, Smartphone, TrendingUp, Users, WalletCards } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { SchoolManagementPage } from "./SchoolManagementPages";
import { SchoolPayPage } from "./SchoolPayPage";
import { MobilePinAccessPage } from "./MobilePinAccessPage";
import { SchoolKioskPage } from "./SchoolKioskPage";

const moduleDefinition: FrontendModuleDefinition = {
  key: "school-management",
  name: "School Management",
  version: "1.11.0",
  order: 20,
  routes: {
    school: { scope: "school:read", view: SchoolManagementPage },
    schoolpins: { scope: "school:write", view: MobilePinAccessPage },
    schoolpay: { scope: "school:read", view: SchoolPayPage },
    schoolkiosk: { scope: "school:read", view: SchoolKioskPage },
  },
  navigation: [
    {
      label: "School",
      icon: School,
      order: 20,
      items: [
        { label: "Overview", path: "school", scope: "school:read", icon: LayoutDashboard },
        { label: "Kiosk dashboard", path: "schoolkiosk", scope: "school:read", icon: Monitor },
        { label: "Students", path: "school/students", scope: "school:read", icon: GraduationCap },
        { label: "Admissions", path: "school/admissions", scope: "school:read", icon: ClipboardCheck },
        { label: "Staff & teachers", path: "school/staff", scope: "school:read", icon: BriefcaseBusiness },
        { label: "Fees & billing", path: "school/fees", scope: "school:read", icon: CircleDollarSign, children: [
          { label: "Configuration", path: "school/fees/structures", icon: Settings2, children: [
            { label: "Fee structures", path: "school/fees/structures" },
            { label: "Discounts & awards", path: "school/fees/discounts" },
            { label: "Late-fee rules", path: "school/fees/late-fees" },
            { label: "Accounting setup", path: "school/fees/accounting" },
          ] },
          { label: "Transactions", path: "school/fees/billing", icon: WalletCards, children: [
            { label: "Billing & charges", path: "school/fees/billing" },
            { label: "Receipts & payments", path: "school/fees/receipts" },
            { label: "Refunds & credits", path: "school/fees/refunds" },
            { label: "Payment plans", path: "school/fees/plans" },
            { label: "Holds & clearance", path: "school/fees/holds" },
          ] },
          { label: "Reports", path: "school/fees/balances", icon: BarChart3, children: [
            { label: "Student balances", path: "school/fees/balances" },
            { label: "Defaulters", path: "school/fees/defaulters" },
            { label: "Class summary", path: "school/fees/class-summary" },
            { label: "Collections", path: "school/fees/collections" },
            { label: "Ageing", path: "school/fees/aging" },
            { label: "Statements", path: "school/fees/statements" },
          ] },
          { label: "Data import", path: "school/fees/opening-import", icon: FileSpreadsheet, children: [
            { label: "Opening balances", path: "school/fees/opening-import" },
            { label: "Payment import", path: "school/fees/payment-import" },
          ] },
        ] },
        { label: "Promotion engine", path: "school/promotion", scope: "school:read", icon: TrendingUp },
        { label: "Discipline & behaviour", path: "school/discipline", scope: "school:read", icon: Gavel },
        { label: "People & access", path: "school/people", scope: "school:read", icon: Users },
        { label: "School setup", path: "school/setup", scope: "school:read", icon: Settings2 },
        { label: "Mobile PIN Access", path: "schoolpins", scope: "school:write", icon: KeyRound },
        { label: "SchoolPay", path: "schoolpay", scope: "school:read", icon: Smartphone },
      ],
    },
  ],
};

export default moduleDefinition;
