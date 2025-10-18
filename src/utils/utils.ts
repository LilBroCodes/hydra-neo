import { glob, hasMagic } from "glob";
import path from "path";

/**
 * Expands glob patterns or paths into absolute file paths.
 */
export function expandGlobList(globsOrPaths: string[], cwd: string): string[] {
  const out: string[] = [];

  for (const g of globsOrPaths) {
    if (hasMagic(g)) {
      const hits = glob.sync(g, { cwd, nodir: true, absolute: false });
      for (const h of hits) out.push(path.resolve(cwd, h));
    } else {
      out.push(path.resolve(cwd, g));
    }
  }

  return out;
}