#!/usr/bin/env node
import { Command } from "commander";
import { run } from "./runner";
import path from "path";
import fs from "fs";
import { readConfigFile } from "./systems/config";
import {
  askYesNo,
  expandGlobList,
  loadChange,
  loadNote,
  loadPackageJSON,
} from "./utils/utils";
import { normalizeMixin, readMixinFile } from "./systems/mixin";
import { generateExtension } from "./handling/extensionGenerator";
import { setup } from "./dev/devStatic";
import { generateSourceCode } from "./handling/mapHandler";

setup();

function resolveConfigPath(
  defaultFiles: string[],
  config_path?: string,
): string {
  if (config_path?.trim()) {
    return path.resolve(process.cwd(), config_path);
  }

  const found = defaultFiles.find((file) =>
    fs.existsSync(path.resolve(process.cwd(), file)),
  );

  if (!found) {
    throw new Error(
      "No config file found. Please provide one or create `hydra.config.yml`, `.yaml`, or `.toml`.",
    );
  }

  return path.resolve(process.cwd(), found);
}

function resolveExtensionConfigPath(config_path?: string): string {
  return resolveConfigPath(
    [
      "hydra.extension.config.yml",
      "hydra.extension.config.yaml",
      "hydra.extension.config.toml",
    ],
    config_path,
  );
}

function resolveBuildConfigPath(config_path?: string): string {
  return resolveConfigPath([
    "hydra.config.yml",
    "hydra.config.yaml",
    "hydra.config.toml",
  ]);
}

const program = new Command();

program
  .name("hydra")
  .description(
    "A CLI tool for injecting mixins into JavaScript bundles using source maps.",
  )
  .version(loadPackageJSON().version);

program
  .command("build")
  .argument("[config_path]", "Path to the config file", "")
  .option("-v, --verbose", "Enable verbose logging")
  .description(
    "Build the project using the specified config file. If no file is provided, Hydra will attempt to auto-resolve one.",
  )
  .action(async (config_path: string, options: { verbose?: boolean }) => {
    const cfgPath = resolveBuildConfigPath(config_path);
    try {
      await run(cfgPath, options.verbose);
    } catch (err) {
      console.error(`Build failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command("info")
  .argument("[config_path]", "Path to the config file", "")
  .description(
    "Display detailed information about the current project, including mixin details.",
  )
  .action(async (config_path: string) => {
    const cfgPath = resolveBuildConfigPath(config_path);

    if (!fs.existsSync(cfgPath)) {
      console.error(`Config file not found at: ${cfgPath}`);
      process.exit(1);
    }

    const cfg = readConfigFile(cfgPath);

    console.log("Project Information:");
    console.log(`- Fail on errors: ${cfg.fail_on_error}`);
    console.log(`- Output folder: ${cfg.output_folder || "./out"}`);
    console.log(`- Bundle path: ${cfg.webpack.bundle}`);
    console.log(`- Source map path: ${cfg.webpack.sourcemap}`);
    console.log(
      `- Mixins: ${cfg.mixins?.length ? cfg.mixins.join(", ") : "None"}`,
    );
    console.log(
      `- Libraries: ${cfg.libs?.length ? cfg.libs.join(", ") : "None"}`,
    );

    const showDetailed = await askYesNo(
      "Would you like to see detailed mixin information?",
    );
    if (!showDetailed || !cfg.mixins?.length) return;

    console.log("\nDetailed Mixin Information:");
    const projectRoot = process.cwd();
    const mixinPaths = expandGlobList(cfg.mixins, projectRoot);

    for (const mixinPath of mixinPaths) {
      try {
        const raw = readMixinFile(mixinPath);
        const norm = normalizeMixin(raw, mixinPath, projectRoot);

        console.log(`\Mixin: ${mixinPath}`);
        console.log(`  - Target: ${norm.target}`);
        console.log(`  - Priority: ${norm.priority}`);
        console.log(`  - Code size: ${norm.code?.length ?? 0} bytes`);
        console.log(`  - Injections (${norm.injections.length}):`);
        norm.injections.forEach((inj, i) => {
          console.log(`    ${i + 1}. Source Method: ${inj.source_method}`);
          console.log(`       Code Method: ${inj.code_method}`);
          console.log(`       Injection Point: ${inj.where}`);
          console.log(`       Priority: ${inj.priority}`);
        });
      } catch (err) {
        console.error(
          `Error reading mixin ${mixinPath}: ${(err as Error).message}`,
        );
        if (cfg.fail_on_error) process.exit(1);
      }
    }
  });

program
  .command("change")
  .option(
    "-c, --count <number>",
    "Number of recent changelog entries to show per page",
    "5",
  )
  .option(
    "-p, --page <number>",
    "Page number of changelog entries to show",
    "1",
  )
  .description("Show Hydras changelogs and developer notes.")
  .action((options: { count: number; page: number }) => {
    if (options.count <= 0) {
      console.error("Count must be a positive integer.");
      process.exit(1);
    }
    if (options.page <= 0) {
      console.error("Page must be a positive integer.");
      process.exit(1);
    }

    const changelog = loadChange();
    const notes = loadNote();

    console.log("Developer Notes:\n");
    console.log(notes.notes.join("\n") + "\n");
    console.log(
      `--- Changelogs (Page ${options.page} of ${Math.ceil(changelog.changes.length / options.count)}) ---`,
    );
    console.log(
      changelog.changes
        .slice((options.page - 1) * options.count, options.page * options.count)
        .map(
          (entry: { version: any; date: any; changes: any[] }) =>
            `Version ${entry.version} - ${entry.date}:\n` +
            entry.changes.map((c) => `  • ${c}`).join("\n"),
        )
        .join("\n\n"),
    );
  });

program
  .command("extension")
  .argument("[extension_config_path]", "Path to the extension config file", "")
  .argument(
    "[build_config_path]",
    "Path to the build config file (optional, only required when using --build)",
    "",
  )
  .option("-v, --verbose", "Enable verbose logging")
  .option("-b, --build", "Build the project before setting up the extension")
  .description(
    "Generate a firefox extension to replace specified javascript bundles with the mixed versions. Also optionally builds the project first.",
  )
  .action(
    async (
      extension_config_path: string,
      build_config_path: string,
      options: { verbose?: boolean; build?: boolean },
    ) => {
      const extCfgPath = resolveExtensionConfigPath(extension_config_path);
      const buildCfgPath = resolveBuildConfigPath(build_config_path);

      if (!extCfgPath) {
        console.error("Extension config file path is required.");
        process.exit(1);
      } else if (options.build && !buildCfgPath) {
        console.error("Build config file path is required when using --build.");
        process.exit(1);
      }

      try {
        if (options.build) {
          await run(buildCfgPath, options.verbose);
        }
      } catch (err) {
        console.error(`Build failed: ${(err as Error).message}`);
        process.exit(1);
      }

      try {
        await generateExtension(extCfgPath, options.verbose);
      } catch (err) {
        console.error(`Extension setup failed: ${(err as Error).message}`);
        process.exit(1);
      }
    },
  );

program
  .command("generate-source")
  .argument("[source_map_file]", "Path to the source map that should be used to generate the source code", "")
  .argument("[output_folder]", "Where the source code should be generated", "")
  .option("-n", "--nocheck", "Disable TS checking in exported files")
  .description("Generates the full source code tree of a bundle file from it's source map.")
  .action(async (source_map_file: string, output_folder: string, options: { n?: boolean }) => {
    console.log(options);
    await generateSourceCode(source_map_file, output_folder, options.n ?? false);
  });

program.parse(process.argv);
