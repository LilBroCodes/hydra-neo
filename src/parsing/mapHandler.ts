import * as t from "@babel/types";
import * as parser from "@babel/parser";
import traverse, { NodePath } from "@babel/traverse";


import { SourceMapConsumer, BasicSourceMapConsumer } from "source-map";
import * as fs from "fs";
import { NormalizedMixin } from "../systems/mixin";
import generate from "@babel/generator";

let sourceMapCache: { [path: string]: BasicSourceMapConsumer } = {};

export async function loadSourceMap(
  path: string,
): Promise<BasicSourceMapConsumer> {
  if (sourceMapCache[path]) {
    return sourceMapCache[path];
  }
  const rawMap = fs.readFileSync(path, "utf-8");
  const smc = await new SourceMapConsumer(JSON.parse(rawMap));
  sourceMapCache[path] = smc;
  return smc;
}

export async function getSourceByFilename(
  path: string | undefined,
  filename: string,
): Promise<string> {
  if (!path) {
    throw new Error(`Source map path is undefined`);
  }
  const smc = await loadSourceMap(path);
  const index = smc.sources.findIndex((src) => src.endsWith(filename));
  if (index === -1) {
    throw new Error(`Source file ${filename} not found in source map ${path}`);
  }

  const sourceCode = smc.sourcesContent?.[index];
  if (!sourceCode) {
    throw new Error(
      `No source content found for ${filename} in source map ${path}`,
    );
  }

  return sourceCode;
}

export function parseSourceToAST(code: string): parser.ParseResult {
  return parser.parse(code, {
    sourceType: "module",
    plugins: ["typescript", "jsx", "classProperties"],
  });
}

export function countMethods(mixins: NormalizedMixin[]): number {
  let methods: string[] = [];
  for (const mixin of mixins) {
    for (const inject of mixin.injections) {
      if (!methods.includes(inject.source_method ?? "")) {
        methods.push(inject.source_method ?? "");
      }
    }
  }
  return methods.filter((m) => m !== "").length;
}

export function getMethodBodyStart(
  ast: parser.ParseResult,
  methodName: string,
): { line: number; column: number } | null {
  let loc: { line: number; column: number } | null = null;

  traverse(ast, {
    FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
      if (path.node.id?.name === methodName && path.node.body.body.length > 0) {
        const firstStmt = path.node.body.body[0];
        if (firstStmt.loc)
          loc = {
            line: firstStmt.loc.start.line,
            column: firstStmt.loc.start.column,
          };
        path.stop();
      }
    },
    ClassMethod(path: NodePath<t.ClassMethod>) {
      if (
        t.isIdentifier(path.node.key, { name: methodName }) &&
        path.node.body.body.length > 0
      ) {
        const firstStmt = path.node.body.body[0];
        if (firstStmt.loc)
          loc = {
            line: firstStmt.loc.start.line,
            column: firstStmt.loc.start.column,
          };
        path.stop();
      }
    },
    ObjectMethod(path: NodePath<t.ObjectMethod>) {
      if (
        t.isIdentifier(path.node.key, { name: methodName }) &&
        path.node.body.body.length > 0
      ) {
        const firstStmt = path.node.body.body[0];
        if (firstStmt.loc)
          loc = {
            line: firstStmt.loc.start.line,
            column: firstStmt.loc.start.column,
          };
        path.stop();
      }
    },
    VariableDeclaration(path: NodePath<t.VariableDeclaration>) {
      for (const decl of path.node.declarations) {
        if (
          t.isIdentifier(decl.id, { name: methodName }) &&
          t.isArrowFunctionExpression(decl.init) &&
          t.isBlockStatement(decl.init.body) &&
          decl.init.body.body.length > 0
        ) {
          const firstStmt = decl.init.body.body[0];
          if (firstStmt.loc)
            loc = {
              line: firstStmt.loc.start.line,
              column: firstStmt.loc.start.column,
            };
          path.stop();
        }
      }
    },
  });

  return loc;
}

export async function getGeneratedPosition(
  smPath: string,
  sourceFile: string,
  line: number,
  column: number,
): Promise<{ line: number; column: number }> {
  const smc = await loadSourceMap(smPath);
  if (!smc) {
    throw new Error(`Source map not found: ${smPath}`);
  } else if (smc.sources.findIndex((src) => src.endsWith(sourceFile)) === -1) {
    throw new Error(
      `Source file ${sourceFile} not found in source map ${smPath}`,
    );
  }

  const pos = smc.generatedPositionFor({
    source: sourceFile,
    line: line,
    column: column,
    bias: SourceMapConsumer.GREATEST_LOWER_BOUND,
  });

  if (pos.line === null || pos.column === null) {
    throw new Error(
      `Generated position not found for ${sourceFile}:${line}:${column} in source map ${smPath}`,
    );
  }

  return { line: pos.line, column: pos.column };
}

export function getMethod(
  ast: parser.ParseResult,
  methodName: string,
): t.Node | null {
  let foundNode: t.Node | null = null;

  traverse(ast, {
    ClassMethod(path: NodePath<t.ClassMethod>) {
      if (
        path.node.key.type === "Identifier" &&
        path.node.key.name === methodName
      ) {
        foundNode = path.node;
        path.stop();
      }
    },
    ObjectMethod(path: NodePath<t.ObjectMethod>) {
      if (
        path.node.key.type === "Identifier" &&
        path.node.key.name === methodName
      ) {
        foundNode = path.node;
        path.stop();
      }
    },
    FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
      if (path.node.id && path.node.id.name === methodName) {
        foundNode = path.node;
        path.stop();
      }
    },
    VariableDeclaration(path: NodePath<t.VariableDeclaration>) {
      for (const decl of path.node.declarations) {
        if (decl.id.type === "Identifier" && decl.id.name === methodName) {
          foundNode = decl;
          path.stop();
        }
      }
    },
  });

  return foundNode;
}

export function getMethodLocation(
  ast: parser.ParseResult,
  methodName: string,
): { line: number; column: number } | null {
  const node = getMethod(ast, methodName);
  if (!node || !node.loc?.start) return null;
  return { line: node.loc.start.line, column: node.loc.start.column };
}

export function getMethodCode(
  ast: parser.ParseResult,
  sourceCode: string,
  methodName: string,
): string | null {
  const node = getMethod(ast, methodName);
  if (!node || !node.loc) return null;

  const { start, end } = node.loc;
  const lines = sourceCode.split(/\r?\n/);

  const selectedLines = lines.slice(start.line - 1, end.line);
  selectedLines[0] = selectedLines[0].slice(start.column);
  selectedLines[selectedLines.length - 1] = selectedLines[
    selectedLines.length - 1
  ].slice(0, end.column);

  return selectedLines.join("\n");
}

export function getMethodCodeInsideFunction(
  ast: t.File,
  fullSource: string,
  methodName: string,
): string | null {
  let code: string | null = null;

  traverse(ast, {
    FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
      if (path.node.id?.name === methodName && path.node.body) {
        code = path.node.body.body
          .map((stmt) => generate(stmt, { compact: true }).code)
          .join("");
        path.stop();
      }
    },
    ClassMethod(path: NodePath<t.ClassMethod>) {
      if (
        t.isIdentifier(path.node.key) &&
        path.node.key.name === methodName &&
        path.node.body
      ) {
        code = path.node.body.body
          .map((stmt: t.Statement) => generate(stmt, { compact: true }).code)
          .join("");
        path.stop();
      }
    },
    ObjectMethod(path: NodePath<t.ObjectMethod>) {
      if (
        t.isIdentifier(path.node.key) &&
        path.node.key.name === methodName &&
        path.node.body
      ) {
        code = path.node.body.body
          .map((stmt: t.Statement) => generate(stmt, { compact: true }).code)
          .join("");
        path.stop();
      }
    },
    VariableDeclaration(path: NodePath<t.VariableDeclaration>) {
      path.node.declarations.forEach((decl: t.VariableDeclarator) => {
        if (t.isIdentifier(decl.id) && decl.id.name === methodName) {
          if (
            t.isArrowFunctionExpression(decl.init) &&
            t.isBlockStatement(decl.init.body)
          ) {
            code = decl.init.body.body
              .map((stmt: t.Statement) => generate(stmt, { compact: true }).code)
              .join("");
            path.stop();
          }
        }
      });
    },
  });

  if (!code && fullSource) {
    const match = fullSource.match(
      new RegExp(
        `function\\s+${methodName}\\s*\\(([^)]*)\\)\\s*{([\\s\\S]*?)}\n?`,
      ),
    );
    if (match) {
      code = match[2].trim();
    }
  }

  return code;
}

export function injectAtHead(
  bundle: string,
  pos: { line: number; column: number },
  previousInjections: { pos: { line: number; column: number }; code: string }[],
  code: string,
): string {
  const lines = bundle.split("\n");

  let lineOffset = 0;
  let columnOffset = 0;

  for (const inj of previousInjections) {
    if (inj.pos.line < pos.line) {
      const addedLines = inj.code.split("\n").length - 1;
      lineOffset += addedLines;
      if (addedLines === 0) {
        columnOffset += inj.code.length;
      }
    } else if (inj.pos.line === pos.line && inj.pos.column <= pos.column) {
      const addedLines = inj.code.split("\n").length - 1;
      if (addedLines > 0) {
        lineOffset += addedLines;
      } else {
        columnOffset += inj.code.length;
      }
    }
  }

  const adjustedLine = pos.line + lineOffset;
  const adjustedColumn = pos.column + columnOffset;

  if (adjustedLine - 1 < 0 || adjustedLine - 1 >= lines.length) {
    throw new Error(`Adjusted line ${adjustedLine} is out of bounds`);
  }

  const targetLine = lines[adjustedLine - 1];
  const before = targetLine.slice(0, adjustedColumn);
  const after = targetLine.slice(adjustedColumn);

  lines[adjustedLine - 1] = before + code + after;
  return lines.join("\n");
}

// export async function injectAtTail(
//   bundle: string,
//   smPath: string,
//   sourceFile: string,
//   ast: t.File,
//   methodName: string,
//   previousInjections: { pos: { line: number; column: number }; code: string }[],
//   code: string,
// ): Promise<string> {
//   // Traverse to find the last statement in the function body
//   let tLastStmtLoc: { line: number; column: number } | null = null;

//   traverse(ast, {
//     FunctionDeclaration(path) {
//       if (path.node.id?.name === methodName && path.node.body.body.length > 0) {
//         const lastStmt = path.node.body.body[path.node.body.body.length - 1];
//         if (lastStmt.loc)
//           tLastStmtLoc = {
//             line: lastStmt.loc.end.line,
//             column: lastStmt.loc.end.column,
//           };
//         path.stop();
//       }
//     },
//     ClassMethod(path) {
//       if (
//         t.isIdentifier(path.node.key, { name: methodName }) &&
//         path.node.body.body.length > 0
//       ) {
//         const lastStmt = path.node.body.body[path.node.body.body.length - 1];
//         if (lastStmt.loc)
//           tLastStmtLoc = {
//             line: lastStmt.loc.end.line,
//             column: lastStmt.loc.end.column,
//           };
//         path.stop();
//       }
//     },
//     ObjectMethod(path) {
//       if (
//         t.isIdentifier(path.node.key, { name: methodName }) &&
//         path.node.body.body.length > 0
//       ) {
//         const lastStmt = path.node.body.body[path.node.body.body.length - 1];
//         if (lastStmt.loc)
//           tLastStmtLoc = {
//             line: lastStmt.loc.end.line,
//             column: lastStmt.loc.end.column,
//           };
//         path.stop();
//       }
//     },
//     VariableDeclaration(path) {
//       for (const decl of path.node.declarations) {
//         if (
//           t.isIdentifier(decl.id, { name: methodName }) &&
//           t.isArrowFunctionExpression(decl.init) &&
//           t.isBlockStatement(decl.init.body) &&
//           decl.init.body.body.length > 0
//         ) {
//           const lastStmt = decl.init.body.body[decl.init.body.body.length - 1];
//           if (lastStmt.loc)
//             tLastStmtLoc = {
//               line: lastStmt.loc.end.line,
//               column: lastStmt.loc.end.column,
//             };
//           path.stop();
//         }
//       }
//     },
//   });

//   if (!tLastStmtLoc) {
//     throw new Error(
//       `Cannot find last statement location for method ${methodName}`,
//     );
//   }

//   let lastStmtLoc: { line: number; column: number } = tLastStmtLoc;

//   const genPos = await getGeneratedPosition(
//     smPath,
//     sourceFile,
//     lastStmtLoc.line,
//     lastStmtLoc.column,
//   );
//   const lines = bundle.split("\n");

//   let lineOffset = 0;
//   let columnOffset = 0;

//   for (const inj of previousInjections) {
//     if (inj.pos.line < genPos.line) {
//       const addedLines = inj.code.split("\n").length - 1;
//       lineOffset += addedLines;
//       if (addedLines === 0) columnOffset += inj.code.length;
//     } else if (
//       inj.pos.line === genPos.line &&
//       inj.pos.column <= genPos.column
//     ) {
//       const addedLines = inj.code.split("\n").length - 1;
//       if (addedLines > 0) lineOffset += addedLines;
//       else columnOffset += inj.code.length;
//     }
//   }

//   const adjustedLine = genPos.line + lineOffset;
//   const adjustedColumn = genPos.column + columnOffset;

//   const targetLine = lines[adjustedLine - 1];
//   const before = targetLine.slice(0, adjustedColumn);
//   const after = targetLine.slice(adjustedColumn);

//   lines[adjustedLine - 1] = before + code + after;
//   return lines.join("\n");
// }
