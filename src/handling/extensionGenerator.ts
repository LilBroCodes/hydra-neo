import { readExtensionConfig } from "../systems/extension";
import { loadExtensionBase } from "../utils/utils";
import path from "path";
import fs from "fs";

export async function generateExtension(
  config_path: string,
  verbose?: boolean,
): Promise<void> {
  const config = readExtensionConfig(config_path);
  const base = loadExtensionBase();

  const out = path.resolve(config.output_folder);
  if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });

  if (verbose) console.log("Copying base background script...");
  fs.writeFileSync(path.join(out, "background.js"), base.script);

  if (verbose) console.log("Generating manifest...");
  const manifest = base.config.replace(
    '"%EXPOSED_FILES"',
    config.files.map((f) => `"${f.name}`).join(", "),
  );
  fs.writeFileSync(path.join(out, "manifest.json"), manifest);

  if (verbose) console.log("Processing source files...");
  for (const f of config.files) {
    const srcPath = path.resolve(f.source);
    if (!fs.existsSync(srcPath)) {
      console.warn(`Source file not found: ${srcPath}. Skipping.`);
      continue;
    }

    fs.copyFileSync(srcPath, path.join(out, f.name));
  }

  const fileJson = {
    urls: config.urls,
    files: config.files.map((f) => ({ name: f.name, regex: f.regex })),
  };

  fs.writeFileSync(
    path.join(out, "files.json"),
    JSON.stringify(fileJson, null, 2),
  );

  if (verbose) console.log(`Extension generated successfully in: ${out}`);
}
