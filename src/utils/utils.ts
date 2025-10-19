import { glob, hasMagic } from "glob";
import path from "path";
import readline from "readline";
import fs from "fs";

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

export function askYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} (y/n): `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === "y");
    });
  });
}

export function loadJSON<T>(relativePath: string): T {
  const basePath = path.resolve(__dirname, relativePath);
  const jsonStr = fs.readFileSync(basePath, "utf-8");
  return JSON.parse(jsonStr) as T;
}

export function loadPackageJSON(): { version: string } {
  return loadJSON("../../package.json");
}

export function loadChange() {
  return loadJSON<{
    changes: { version: string; date: string; changes: string[] }[];
  }>("../assets/change.json");
}

export function loadNote() {
  return loadJSON<{ notes: string[] }>("../assets/notes.json");
}

export function loadExtensionBase() {
  return loadJSON<{ config: string, script: string }>("../assets/extension_base.json");
}
