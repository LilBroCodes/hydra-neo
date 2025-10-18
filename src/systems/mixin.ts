import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { z } from "zod";

const InjectionZ = z.object({
  where: z.enum(["HEAD", "TAIL"]),
  priority: z.number().optional(),
  source_method: z.string(),
  code_method: z.string(),
});

const MixinMetaZ = z.object({
  target: z.string(),
  code_file: z.string(),
  priority: z.number().optional(),
  injections: z.array(InjectionZ),
});

export type RawMixin = z.infer<typeof MixinMetaZ>;

export type NormalizedInjection = {
  where: "HEAD" | "TAIL";
  priority: number;
  source_method?: string;
  code_method?: string;
};

export type NormalizedMixin = {
  id: string;
  target: string;
  code?: string;
  priority: number;
  injections: NormalizedInjection[];
  sourceMixinPath: string;
};

export function readMixinFile(mixinPath: string): RawMixin {
  const ext = path.extname(mixinPath).toLowerCase();
  if (ext !== ".yml") throw new Error("Mixin files must be .yml");
  const raw = fs.readFileSync(mixinPath, "utf8");
  const parsed = yaml.load(raw);
  return MixinMetaZ.parse(parsed ?? {});
}

export function normalizeMixin(
  raw: RawMixin,
  mixinPath: string,
  projectRoot: string,
): NormalizedMixin {
  const target = typeof raw.target === "string" ? raw.target : "";

  if (target.trim() === "") {
    throw new Error("Mixin target is required");
  }
  const mixinDir = path.dirname(mixinPath);
  const candidateA = path.resolve(mixinDir, raw.code_file);
  const candidateB = path.resolve(projectRoot, raw.code_file);
  let codePath: string | null = null;
  if (fs.existsSync(candidateA) && fs.statSync(candidateA).isFile())
    codePath = candidateA;
  else if (fs.existsSync(candidateB) && fs.statSync(candidateB).isFile())
    codePath = candidateB;
  else
    throw new Error(
      `code_file not found (tried ${candidateA} and ${candidateB})`,
    );
  const code = fs.readFileSync(codePath, "utf8");

  const injections: NormalizedInjection[] = (raw.injections ?? []).map(
    (inj) => ({
      where: inj.where?.toUpperCase() === "TAIL" ? "TAIL" : "HEAD",
      priority: typeof inj.priority === "number" ? inj.priority : 0,
      source_method: inj.source_method,
      code_method: inj.code_method,
    }),
  );

  injections.forEach((inj, _) => {
    if (inj.code_method == undefined || !code.includes(inj.code_method)) {
      throw new Error(
        `code_method invalid or not found in code: ${inj.code_method}`,
      );
    }
  });

  return {
    id: path.basename(mixinPath),
    target,
    code,
    priority: typeof raw.priority === "number" ? raw.priority : 0,
    injections,
    sourceMixinPath: mixinPath,
  };
}

export function applyMixin(m: NormalizedMixin) {
  console.log(
    `Found mixin for target: ${m.target} (from ${m.sourceMixinPath})`,
  );
  console.log(JSON.stringify(m, null, 2));
}
