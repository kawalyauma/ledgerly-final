import { useEffect, useState } from "react";
import {
  LayoutDashboard, Landmark, ShoppingCart, FolderKanban, Warehouse,
  Percent, FileBarChart, Building2, Activity,
} from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { get } from "../../../web/api";
import { Card, Spinner, Notice } from "../../../web/components/ui";
import { AccountsPage, GroupsPage, DimensionsPage, OpeningBalancesPage } from "../../../web/pages/AccountingPages";
import { JournalsPage, ProductsPage, SalesPage, PurchasingPage, ApprovalsPage, ReceivablesPage } from "../../../web/pages/FinanceOperationsPages";
import { ExpensesPage, ProjectsPage, RecurringPage } from "../../../web/pages/OperationsPages";
import {
  BudgetsPage, ClosingPage, ReportsPage, ReportManagementPage, DashboardsPage,
  DocumentDeliveryPage, CompliancePage, IntegrationsPage,
} from "../../../web/pages/PlanningReportingPages";
import { BankingPage, InventoryPage } from "../../../web/pages/BankingInventoryPages";
import { TaxPage } from "../../../web/pages/TaxPayrollPages";
import { OrganizationPage } from "../../../web/pages/OrganizationPages";
import { TeamPage, ApiKeysPage } from "../../../web/pages/AdminPages";
import { ModulesPage } from "../../../web/pages/ModulesPage";

type HealthComponent = { status: string; latencyMs?: number; error?: string };
type Health = { status: string; timestamp: string; components: Record<string, HealthComponent> };

function SystemStatusPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { get<Health>("/system/health").then(setHealth).catch(e => setError(e.message)); }, []);
  return <div className="page">
    <div className="page-header"><div><h1>System status</h1><p>Live health of the API, database, cache and storage.</p></div></div>
    <Card>
      {error ? <Notice tone="danger">{error}</Notice> : !health ? <Spinner/> : <div className="summary-grid">
        <span><small>Overall</small><b>{health.status}</b></span>
        {Object.entries(health.components).map(([name, c]) => <span key={name}><small>{name}</small><b>{c.status}{c.latencyMs != null ? ` · ${c.latencyMs}ms` : ""}</b></span>)}
      </div>}
    </Card>
  </div>;
}

const moduleDefinition: FrontendModuleDefinition = {
  key: "ledgerly",
  name: "Ledgerly Core",
  version: "1.0.0",
  order: 1,
  routes: {
    dashboards: { view: DashboardsPage },
    "system-status": { view: SystemStatusPage },

    accounts: { scope: "accounts:read", view: AccountsPage },
    groups: { scope: "accounts:read", view: GroupsPage },
    dimensions: { scope: "accounts:read", view: DimensionsPage },
    openingBalances: { scope: "accounts:write", view: OpeningBalancesPage },
    journals: { scope: "journals:read", view: JournalsPage },

    products: { scope: "products:read", view: ProductsPage },
    sales: { scope: "documents:read", view: SalesPage },
    purchasing: { scope: "documents:read", view: PurchasingPage },
    receivables: { scope: "documents:read", view: ReceivablesPage },
    approvals: { scope: "documents:read", view: ApprovalsPage },

    expenses: { scope: "documents:read", view: ExpensesPage },
    recurring: { scope: "documents:read", view: RecurringPage },
    projects: { scope: "accounts:read", view: ProjectsPage },

    banking: { scope: "payments:read", view: BankingPage },
    inventory: { scope: "products:read", view: InventoryPage },

    tax: { scope: "reports:read", view: TaxPage },

    budgets: { scope: "reports:read", view: BudgetsPage },
    closing: { scope: "periods:write", view: ClosingPage },
    reports: { scope: "reports:read", view: ReportsPage },
    reportManagement: { scope: "reports:read", view: ReportManagementPage },
    documentDelivery: { scope: "documents:read", view: DocumentDeliveryPage },

    organization: { scope: "admin:read", view: OrganizationPage },
    team: { scope: "admin:read", view: TeamPage },
    apiKeys: { scope: "admin:read", admin: true, view: ApiKeysPage },
    modules: { scope: "admin:read", admin: true, view: ModulesPage },
    compliance: { scope: "admin:read", admin: true, view: CompliancePage },
    integrations: { scope: "admin:read", admin: true, view: IntegrationsPage },
  },
  navigation: [
    { label: "Dashboards", icon: LayoutDashboard, order: 1, items: [
      { label: "Dashboards", path: "dashboards" },
    ] },
    { label: "Accounting", icon: Landmark, order: 5, items: [
      { label: "Chart of accounts", path: "accounts", scope: "accounts:read" },
      { label: "Account groups", path: "groups", scope: "accounts:read" },
      { label: "Dimensions", path: "dimensions", scope: "accounts:read" },
      { label: "Opening balances", path: "openingBalances", scope: "accounts:write" },
      { label: "Journals", path: "journals", scope: "journals:read" },
    ] },
    { label: "Sales & Purchasing", icon: ShoppingCart, order: 8, items: [
      { label: "Products & services", path: "products", scope: "products:read" },
      { label: "Sales", path: "sales", scope: "documents:read" },
      { label: "Purchasing", path: "purchasing", scope: "documents:read" },
      { label: "Receivables", path: "receivables", scope: "documents:read" },
      { label: "Approvals", path: "approvals", scope: "documents:read" },
    ] },
    { label: "Operations", icon: FolderKanban, order: 10, items: [
      { label: "Expenses", path: "expenses", scope: "documents:read" },
      { label: "Recurring transactions", path: "recurring", scope: "documents:read" },
      { label: "Projects", path: "projects", scope: "accounts:read" },
    ] },
    { label: "Banking & Inventory", icon: Warehouse, order: 12, items: [
      { label: "Banking", path: "banking", scope: "payments:read" },
      { label: "Inventory", path: "inventory", scope: "products:read" },
    ] },
    { label: "Tax", icon: Percent, order: 14, items: [
      { label: "Tax", path: "tax", scope: "reports:read" },
    ] },
    { label: "Planning & Reporting", icon: FileBarChart, order: 16, items: [
      { label: "Budgets", path: "budgets", scope: "reports:read" },
      { label: "Period closing", path: "closing", scope: "periods:write" },
      { label: "Reports", path: "reports", scope: "reports:read" },
      { label: "Report management", path: "reportManagement", scope: "reports:read" },
      { label: "Document delivery", path: "documentDelivery", scope: "documents:read" },
    ] },
    { label: "Organization", icon: Building2, order: 90, items: [
      { label: "Organization settings", path: "organization", scope: "admin:read" },
      { label: "Team", path: "team", scope: "admin:read" },
      { label: "API keys", path: "apiKeys", scope: "admin:read", admin: true },
      { label: "Modules", path: "modules", scope: "admin:read", admin: true },
      { label: "Compliance", path: "compliance", scope: "admin:read", admin: true },
      { label: "Integrations", path: "integrations", scope: "admin:read", admin: true },
    ] },
    { label: "System status", icon: Activity, order: 99, items: [
      { label: "System status", path: "system-status" },
    ] },
  ],
};

export default moduleDefinition;
