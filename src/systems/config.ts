import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import toml from "toml";
import { z } from "zod";

export const InjectionZ = z.enum(["HEAD", "TAIL"]);

export const WebpackZ = z.object({
  bundle: z.string().min(1),
  sourcemap: z.string().min(1),
});

export const ConfigZ = z.object({
  fail_on_error: z.boolean().optional().default(false),
  output_folder: z.string().optional().default("./out"),
  webpack: WebpackZ,
  mixins: z.array(z.string()),
  libs: z.array(z.string()).optional().default([]),
});

export type Config = z.infer<typeof ConfigZ>;

export function readConfigFile(configPath: string): Config {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config not found: ${configPath}`);
  }

  const ext = path.extname(configPath).toLowerCase();
  const raw = fs.readFileSync(configPath, "utf8");
  let parsed: unknown;

  if (ext === ".yml" || ext === ".yaml") {
    parsed = yaml.load(raw);
  } else if (ext === ".toml") {
    parsed = toml.parse(raw);
  } else {
    throw new Error("Unsupported config extension. Use .yml, .yaml, or .toml");
  }

  return ConfigZ.parse(parsed ?? {});
}
