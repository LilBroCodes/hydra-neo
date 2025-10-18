import path from "path";
import { readConfigFile, type Config } from "./input/config";
import { expandGlobList } from "./utils/utils";
import { readMixinFile, normalizeMixin, applyMixin, type NormalizedMixin } from "./systems/mixin";

export async function run(configPath: string): Promise<void> {
  const projectRoot = process.cwd();
  const cfg = readConfigFile(configPath);

  const mixinGlobs = cfg.mixins ?? [];
  const mixinPaths = expandGlobList(mixinGlobs, projectRoot);

  if (mixinPaths.length === 0) {
    console.warn("No mixin files matched your globs:", mixinGlobs);
    return;
  }

  for (const mixinPath of mixinPaths) {
    try {
      const raw = readMixinFile(mixinPath);
      const normalized: NormalizedMixin = normalizeMixin(raw, mixinPath, cfg.defaults ?? {}, projectRoot);
      applyMixin(normalized);
    } catch (err) {
      console.error("Failed to process mixin", mixinPath, "->", err instanceof Error ? err.message : err);
    }
  }
}
