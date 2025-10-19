import cliSpinners from "cli-spinners";
import ora from "ora";
import fs from "fs";
import { readConfigFile } from "./systems/config";
import { expandGlobList } from "./utils/utils";
import {
  NormalizedMixin,
  readMixinFile,
  normalizeMixin,
} from "./systems/mixin";
import {
  getGeneratedPosition,
  getMethodBodyStart,
  getMethodCodeInsideFunction,
  getSourceByFilename,
  injectAtHead,
  parseSourceToAST,
} from "./handling/mapHandler";
import { ParseResult } from "@babel/parser";
import path from "path";

export async function run(configPath: string, verbose = false): Promise<void> {
  const projectRoot = process.cwd();
  const cfg = readConfigFile(configPath);

  const logOrSpinner = {
    start: (msg: string) => {
      if (verbose) console.log(msg);
      else return ora({ text: msg, spinner: cliSpinners.dots }).start();
    },
    succeed: (spinner: any, msg: string) => {
      if (verbose) console.log(msg);
      else spinner.succeed(msg);
    },
    fail: (spinner: any, msg: string) => {
      if (verbose) console.error(msg);
      else spinner.fail(msg);
    },
  };

  const bundleSpinner = logOrSpinner.start(
    `Loading bundle file: ${cfg.webpack.bundle}`,
  );
  let bundle: string;
  try {
    bundle = fs.readFileSync(cfg.webpack.bundle, "utf-8");
    logOrSpinner.succeed(
      bundleSpinner,
      `Loaded bundle file (${bundle.length} bytes)`,
    );
  } catch (err) {
    logOrSpinner.fail(
      bundleSpinner,
      `Failed to read bundle: ${(err as Error).message}`,
    );
    throw err;
  }

  const mixinGlobs = cfg.mixins ?? [];
  const mixinPaths = expandGlobList(mixinGlobs, projectRoot);
  if (mixinPaths.length === 0) {
    console.warn("No mixin files matched your globs:", mixinGlobs);
    return;
  }

  const mixinSpinner = logOrSpinner.start(
    `Loading ${mixinPaths.length} mixin(s)...`,
  );
  const normalized: NormalizedMixin[] = [];
  let loadErrors = 0;

  for (const mixinPath of mixinPaths) {
    try {
      const raw = readMixinFile(mixinPath);
      const norm = normalizeMixin(raw, mixinPath, projectRoot);
      normalized.push(norm);
      if (verbose) console.log(`Loaded mixin: ${mixinPath}`);
    } catch (err) {
      loadErrors++;
      logOrSpinner.fail(
        mixinSpinner,
        `Error loading mixin ${mixinPath}: ${(err as Error).message}`,
      );
      if (cfg.fail_on_error) throw err;
    }
  }
  logOrSpinner.succeed(
    mixinSpinner,
    `Loaded ${normalized.length} mixin(s). ` +
      (loadErrors > 0 ? ` Errors: ${loadErrors}` : ""),
  );

  const sourceSpinner = logOrSpinner.start(
    `Finding sources for ${normalized.length} mixin(s)...`,
  );
  const sources: { sourceName: string; sourceCode: string }[] = [];
  let sourceErrors = 0;

  for (const mixin of normalized) {
    try {
      const source = await getSourceByFilename(
        cfg.webpack.sourcemap,
        mixin.target.replace("#", ""),
      );
      sources.push(source);
      if (verbose) console.log(`Found source for target: ${mixin.target}`);
    } catch (err) {
      sourceErrors++;
      logOrSpinner.fail(
        sourceSpinner,
        `Error finding source for ${mixin.target}: ${(err as Error).message}`,
      );
      if (cfg.fail_on_error) throw err;
    }
  }
  logOrSpinner.succeed(
    sourceSpinner,
    `Found ${sources.length} source(s). ` +
      (sourceErrors > 0 ? ` Errors: ${sourceErrors}` : ""),
  );

  const parseSpinner = logOrSpinner.start(
    `Parsing ${sources.length} source(s)...`,
  );
  const parsedSources: ParseResult[] = [];
  let parseErrors = 0;

  for (const source of sources) {
    try {
      const parsed = parseSourceToAST(source.sourceCode);
      parsedSources.push(parsed);
    } catch (err) {
      parseErrors++;
      logOrSpinner.fail(
        parseSpinner,
        `Error parsing source: ${(err as Error).message}`,
      );
      if (cfg.fail_on_error) throw err;
    }
  }
  logOrSpinner.succeed(
    parseSpinner,
    `Parsed ${parsedSources.length} source(s). ` +
      (parseErrors > 0 ? ` Errors: ${parseErrors}` : ""),
  );

  const injectSpinner = logOrSpinner.start(
    `Injecting methods into ${parsedSources.length} source(s)...`,
  );
  normalized.sort((a, b) => a.priority - b.priority);
  let injections: { pos: { line: number; column: number }; code: string }[] =
    [];
  let injectErrors = 0;

  for (let i = 0; i < normalized.length; i++) {
    const mixin = normalized[i];
    const ast = parsedSources[i];
    const source = sources[i];
    const mixinAst = parseSourceToAST(mixin.code!);

    mixin.injections.sort((a, b) => a.priority - b.priority);

    for (const injection of mixin.injections) {
      if (!injection.source_method) continue;

      const loc = getMethodBodyStart(ast, injection.source_method);
      if (!loc) {
        injectErrors++;
        logOrSpinner.fail(
          injectSpinner,
          `Method ${injection.source_method} not found in ${mixin.target}`,
        );
        if (cfg.fail_on_error)
          throw new Error(`Method ${injection.source_method} not found`);
        continue;
      }

      let genPos: { line: number; column: number };
      try {
        genPos = await getGeneratedPosition(
          cfg.webpack.sourcemap,
          source.sourceName,
          loc.line,
          loc.column,
        );
      } catch (err) {
        injectErrors++;
        logOrSpinner.fail(
          injectSpinner,
          `Failed to get generated position for ${injection.source_method}: ${(err as Error).message}`,
        );
        if (cfg.fail_on_error) throw err;
        continue;
      }

      const methodCode = getMethodCodeInsideFunction(
        mixinAst,
        mixin.code!,
        injection.code_method!,
      );
      if (!methodCode) {
        injectErrors++;
        logOrSpinner.fail(
          injectSpinner,
          `Failed to retrieve code for method ${injection.source_method} in ${mixin.target}`,
        );
        if (cfg.fail_on_error)
          throw new Error(
            `Failed to retrieve code for ${injection.source_method}`,
          );
        continue;
      }

      if (injection.where === "HEAD") {
        bundle = injectAtHead(bundle, genPos, injections, methodCode);
        injections.push({ pos: genPos, code: methodCode });
        if (verbose)
          console.log(
            `Injected method ${injection.source_method} at HEAD of ${mixin.target}`,
          );
      } else if (injection.where === "TAIL") {
        throw new Error("TAIL injection not yet implemented");

        // try {
        //   bundle = await injectAtTail(
        //     bundle,
        //     cfg.webpack.sourcemap,
        //     mixin.target.replace("#", ""),
        //     ast,
        //     injection.source_method,
        //     injections,
        //     methodCode,
        //   );
        //   injections.push({
        //     pos: await getGeneratedPosition(
        //       cfg.webpack.sourcemap,
        //       mixin.target.replace("#", ""),
        //       getMethodBodyStart(ast, injection.source_method)!.line,
        //       getMethodBodyStart(ast, injection.source_method)!.column,
        //     ),
        //     code: methodCode,
        //   });
        //   if (verbose)
        //     console.log(
        //       `Injected method ${injection.source_method} at TAIL of ${mixin.target}`,
        //     );
        // }
        // catch (err) {
        //   injectErrors++;
        //   logOrSpinner.fail(
        //     injectSpinner,
        //     `Failed to inject at TAIL for ${injection.source_method}: ${(err as Error).message}`,
        //   );
        //   if (cfg.fail_on_error) throw err;
        // }
      }
    }
  }
  logOrSpinner.succeed(
    injectSpinner,
    `Injected ${injections.length} methods. ` +
      (injectErrors > 0 ? ` Errors: ${injectErrors}` : ""),
  );

  const writeSpinner = logOrSpinner.start(`Writing modified bundle to disk...`);
  const outputFile = path.join(
    cfg.output_folder,
    cfg.webpack.bundle.split("/").pop()!,
  );
  fs.mkdirSync(cfg.output_folder, { recursive: true });
  fs.writeFileSync(outputFile, bundle, "utf-8");
  logOrSpinner.succeed(writeSpinner, `Wrote modified bundle to: ${outputFile}`);
}
