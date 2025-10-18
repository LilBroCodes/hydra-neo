import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { z } from "zod";
import { expandGlobList } from "../utils/utils"

export const MethodSelectorZ = z
  .object({
    name: z.string().optional(),
    pattern: z.string().optional(),
  })
  .refine((v) => !!(v.name || v.pattern), { message: "method must have name or pattern" })
  .optional()
  .default({});

export const MixinZ = z.object({
  meta: z.record(z.string(), z.any()).optional(),
  target: z.union([z.string(), z.array(z.string())]),
  method: MethodSelectorZ,
  where: z.enum(["HEAD", "TAIL"]).optional(),
  code: z.string().optional(),
  code_file: z.string().optional(),
  priority: z.number().optional(),
  conditions: z.record(z.string(), z.any()).optional(),
});

export type RawMixin = z.infer<typeof MixinZ>;

export type NormalizedMixin = {
  id: string;
  meta?: Record<string, any>;
  targets: string[]; // absolute paths
  method: { name?: string; pattern?: string } | { any?: true };
  where: "HEAD" | "TAIL";
  code?: string; // raw code content
  priority?: number;
  conditions?: Record<string, any>;
  sourceMixinPath: string;
};

export function readMixinFile(mixinPath: string): RawMixin {
  const ext = path.extname(mixinPath).toLowerCase();
  if (ext !== ".yml") throw new Error("Mixin files must be .yml");
  const raw = fs.readFileSync(mixinPath, "utf8");
  const parsed = yaml.load(raw);
  return MixinZ.parse(parsed ?? {});
}

export function normalizeMixin(raw: RawMixin, mixinPath: string, defaults: { injection?: "HEAD" | "TAIL" | undefined }, projectRoot: string): NormalizedMixin {
  const meta = raw.meta ?? {};
  const targetRaw = raw.target;
  const targets = Array.isArray(targetRaw) ? targetRaw.map(String) : [String(targetRaw)];

  let method: any;
  if (!raw.method || Object.keys(raw.method).length === 0) method = { any: true };
  else if ((raw.method as any).name) method = { name: String((raw.method as any).name) };
  else if ((raw.method as any).pattern) method = { pattern: String((raw.method as any).pattern) };
  else method = { any: true };

  const where = (raw.where ?? defaults?.injection ?? "HEAD").toUpperCase() === "TAIL" ? "TAIL" : "HEAD";
  const priority = typeof raw.priority === "number" ? raw.priority : meta?.priority ?? 0;

  let code: string | undefined;
  if (raw.code) {
    code = String(raw.code);
  } else if (raw.code_file) {
    const mixinDir = path.dirname(mixinPath);
    const candidateA = path.resolve(mixinDir, String(raw.code_file));
    const candidateB = path.resolve(projectRoot, String(raw.code_file));
    let chosen: string | null = null;
    if (fs.existsSync(candidateA) && fs.statSync(candidateA).isFile()) chosen = candidateA;
    else if (fs.existsSync(candidateB) && fs.statSync(candidateB).isFile()) chosen = candidateB;
    else throw new Error(`code_file not found (tried ${candidateA} and ${candidateB})`);
    code = fs.readFileSync(chosen, "utf8");
  }

  const resolvedTargets = expandGlobList(targets, projectRoot);

  return {
    id: meta.name ?? path.basename(mixinPath),
    meta,
    targets: resolvedTargets,
    method,
    where,
    code,
    priority,
    conditions: raw.conditions ?? {},
    sourceMixinPath: mixinPath,
  };
}

export function applyMixin(m: NormalizedMixin) {
  console.log("=== MIXIN:", m.id);
  console.log("source mixin:", m.sourceMixinPath);
  console.log("priority:", m.priority);
  console.log("where:", m.where);
  console.log("method:", m.method);
  console.log("targets:");
  for (const t of m.targets) console.log("  -", t);
  if (m.code) {
    console.log("--- code preview ---");
    console.log(m.code.slice(0, 400));
    if (m.code.length > 400) console.log("... (truncated)");
    console.log("--- end preview ---");
  } else {
    console.log("(no code provided)");
  }
  console.log();
}
