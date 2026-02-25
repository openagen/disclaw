import { promises as fs } from "fs";
import path from "path";

const DOC_ROOT = path.join(process.cwd(), "clawshopping");

const DOC_MAP = {
  skill: path.join(DOC_ROOT, "SKILL.md"),
  apiContracts: path.join(DOC_ROOT, "references", "api-contracts.md"),
  domainModel: path.join(DOC_ROOT, "references", "domain-model.md"),
  stateMachines: path.join(DOC_ROOT, "references", "state-machines.md"),
  paymentsCompliance: path.join(DOC_ROOT, "references", "payments-compliance.md"),
  mvpScope: path.join(DOC_ROOT, "references", "mvp-scope.md")
} as const;

export async function readSkillDoc(name: keyof typeof DOC_MAP) {
  const filePath = DOC_MAP[name];
  return fs.readFile(filePath, "utf8");
}
