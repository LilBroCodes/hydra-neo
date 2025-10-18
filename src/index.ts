import { setup } from "./dev/devStatic";
import { LOGGER } from "./dev/constants";
import path from "path";
import { run } from "./runner";


setup();
const argv = process.argv.slice(2);
const cfg = argv[0] ?? "hydra.config.yml";

// Resolve relative to current working directory (the /run/ dir when you cd there)
const cfgPath = path.resolve(process.cwd(), cfg);

(async () => {
  try {
    await run(cfgPath);
  } catch (err) {
    LOGGER.error("Fatal error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
})();
