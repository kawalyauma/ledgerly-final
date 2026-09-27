import { readFile } from "node:fs/promises";

const cssFiles = [
  "web/fusion.css",
  "web/fusion-education.css",
  "web/fusion-business.css",
  "web/fusion-tools.css",
  "web/fusion-dashboard.css",
  "web/fusion-public.css",
];

const requiredImports = cssFiles.map(path => `import "./${path.replace("web/", "")}";`);
const failures = [];

function count(text, char) {
  return [...text].reduce((n, value) => n + Number(value === char), 0);
}

for (const path of cssFiles) {
  const css = await readFile(path, "utf8");
  if (count(css, "{") !== count(css, "}")) failures.push(`${path}: unbalanced CSS braces`);
  if (css.includes("\\n")) failures.push(`${path}: contains a literal \\n escape outside generated content`);
  if (!css.includes("@media")) failures.push(`${path}: missing responsive media queries`);
}

const main = await readFile("web/main.tsx", "utf8");
for (const statement of requiredImports) {
  if (!main.includes(statement)) failures.push(`web/main.tsx: missing ${statement}`);
}

const shell = await readFile("web/components/AppShell.tsx", "utf8");
const shellRequirements = [
  'className="module-strip"',
  'className="mobile-dock"',
  'className="global-search"',
  'sessionStorage.setItem("ledgerly-ai.prefill"',
  'searchRef.current?.focus()',
];
for (const requirement of shellRequirements) {
  if (!shell.includes(requirement)) failures.push(`AppShell.tsx: missing shell requirement ${requirement}`);
}

const home = await readFile("modules/ledgerly/frontend/FusionWelcome.tsx", "utf8");
for (const requirement of ["School feed", "School at a glance", "fusion-quick"]) {
  if (!home.includes(requirement)) failures.push(`FusionWelcome.tsx: missing ${requirement}`);
}

const design = await readFile("docs/UI_DESIGN_SYSTEM.md", "utf8");
if (!design.includes("Responsive breakpoints")) failures.push("UI design system: responsive contract missing");

if (failures.length) {
  console.error("Fusion UI checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Fusion UI checks passed for ${cssFiles.length} CSS layers and the shared shell.`);
