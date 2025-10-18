import path from "path";
import process from "process";

export function setup(): void {
  process.chdir(path.resolve(__dirname, "../../run"));
}
