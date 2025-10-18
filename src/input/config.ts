import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import toml from "toml";
import { z } from "zod";

export const InjectionZ = z.enum(["HEAD", "TAIL"]);

export const WebpackZ = z.object({
  bundle: z.string().min(1),
  sourcemap: z.string().optional(),
});

export const ConfigZ = z.object({
  webpack: WebpackZ.optional(),
  mixins: z.array(z.string()).optional().default([]),
  defaults: z
    .object({
      injection: InjectionZ.optional(),
      sourceLang: z.string().optional()
    })
    .optional()
    .default({}),
});

export type Config = z.infer<typeof ConfigZ>;

export function readConfigFile(configPath: string): Config {
  const ext = path.extname(configPath).toLowerCase();
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config not found: ${configPath}`);
  }
  const raw = fs.readFileSync(configPath, "utf8");
  let parsed: unknown;
  if (ext === ".yml") {
    parsed = yaml.load(raw);
  } else if (ext === ".toml") {
    parsed = toml.parse(raw);
  } else {
    throw new Error("Unsupported config extension. Use .yml or .toml");
  }
  const cfg = ConfigZ.parse(parsed ?? {});
  return cfg;
}
