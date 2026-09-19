export const BUILT_IN_EMPLOYEE_KEYS = [
  "amani",
  "kato",
  "maya",
  "tendo",
  "nia",
  "jabali",
  "safi",
  "elimu",
  "hesabu",
  "ripoti",
  "kumbuka",
  "forge",
] as const;

export type BuiltInEmployeeKey = (typeof BUILT_IN_EMPLOYEE_KEYS)[number];

export const BUILT_IN_EMPLOYEE_NAMES: Record<BuiltInEmployeeKey, string> = {
  amani: "Amani",
  kato: "Kato",
  maya: "Maya",
  tendo: "Tendo",
  nia: "Nia",
  jabali: "Jabali",
  safi: "Safi",
  elimu: "Elimu",
  hesabu: "Hesabu",
  ripoti: "Ripoti",
  kumbuka: "Kumbuka",
  forge: "Forge",
};
