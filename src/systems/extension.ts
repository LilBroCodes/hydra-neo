import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import toml from "toml";
import { z } from "zod";

export const ExtensionFileZ = z.object({
  name: z.string().min(1, "Each file entry must have a name."),
  regex: z.string().min(1, "Each file entry must have a regex pattern."),
  source: z.string().min(1, "Each file entry must define a source path."),
});

export const ExtensionConfigZ = z.object({
  name: z.string().min(1, "Extension must have a name."),
  version: z.string().optional().default("1.0.0"),
  urls: z
    .array(z.string())
    .nonempty("At least one URL pattern must be defined."),
  files: z.array(ExtensionFileZ).nonempty("At least one file must be defined."),
  output_folder: z.string().optional().default("./out/extension"),
});

export type ExtensionConfig = z.infer<typeof ExtensionConfigZ>;

export function readExtensionConfig(configPath: string): ExtensionConfig {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Extension config not found: ${configPath}`);
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

  return ExtensionConfigZ.parse(parsed ?? {});
}
