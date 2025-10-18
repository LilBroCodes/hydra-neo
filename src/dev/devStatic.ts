import path from "path";
import process from "process";
import { DEBUG, LOGGER } from "./constants";

export function setup(): void {
    process.chdir(path.resolve(__dirname, "../../run"));

    if (DEBUG) {
        LOGGER.debug("Changed working directory to /run")
    }
}