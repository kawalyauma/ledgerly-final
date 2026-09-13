import { School } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { SchoolManagementPage } from "./SchoolManagementPages";
import { SchoolPayPage } from "./SchoolPayPage";

const moduleDefinition: FrontendModuleDefinition = {
  key: "school-management",
  name: "School Management",
  version: "1.6.0",
  order: 20,
  routes: {
    school: { scope: "school:read", view: SchoolManagementPage },
    schoolpay: { scope: "school:read", view: SchoolPayPage },
  },
  navigation: [
    {
      label: "School Management",
      icon: School,
      order: 20,
      items: [
        { label: "School Management", path: "school", scope: "school:read" },
        { label: "SchoolPay", path: "schoolpay", scope: "school:read" },
      ],
    },
  ],
};

export default moduleDefinition;