import { Logger } from "tslog";

export const DEBUG = true;
export const LOGGER = new Logger({
  name: "Hydra",
  type: process.env.NODE_ENV === "production" ? "json" : "pretty",
  minLevel: DEBUG ? 0 : 2,
  hideLogPositionForProduction: true,
  stylePrettyLogs: true,
  prettyLogTimeZone: "local",
  prettyLogTemplate:
    "{{yyyy}}-{{mm}}-{{dd}} {{hh}}:{{MM}}:{{ss}}.{{ms}}\t{{logLevelName}}\t[{{name}}] ",
  prettyErrorTemplate:
    "\n{{errorName}}: {{errorMessage}}\n{{errorStack}}",
  prettyErrorStackTemplate: "    at {{fileName}}:{{lineNumber}}:{{columnNumber}}",
  prettyErrorParentNamesSeparator: ":",
  prettyErrorLoggerNameDelimiter: "\t",
  maskValuesOfKeys: ["password", "token", "secret"],
  maskValuesRegEx: [/(Bearer\s+)?[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g],
});