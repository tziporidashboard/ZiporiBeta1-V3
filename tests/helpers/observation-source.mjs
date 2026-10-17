import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const read = (file) => readFileSync(resolve(root, file), "utf8");
export const tree = (source) =>
  ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  jsx: ts.JsxEmit.ReactJSX,
  esModuleInterop: true,
};

export function find(ast, predicate) {
  const matches = [];
  function visit(node) {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(matches.length, 1, "Expected one matching production declaration");
  return matches[0];
}

export function functionText(ast, name) {
  return find(ast, (n) => ts.isFunctionDeclaration(n) && n.name?.text === name)
    .getText(ast)
    .replace(/^export\s+/, "");
}

export function variable(ast, name) {
  return find(ast, (n) => ts.isVariableDeclaration(n) && n.name.getText(ast) === name);
}

export function evaluate(code, bindings = {}) {
  const compiled = ts.transpileModule(code, { compilerOptions }).outputText;
  return new Function("require", "exports", ...Object.keys(bindings), compiled)(
    createRequire(import.meta.url),
    {},
    ...Object.values(bindings),
  );
}

// Use the project's installed TypeScript compiler, without emitted files or
// production-only exports for private helpers. Browser effects are never run.
const moduleCache = new Map();
export function loadProductionModule(file) {
  const path = resolve(root, file);
  if (moduleCache.has(path)) return moduleCache.get(path).exports;
  const module = { exports: {} };
  moduleCache.set(path, module);
  const nativeRequire = createRequire(path);
  function requireModule(specifier) {
    if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return nativeRequire(specifier);
    const base = specifier.startsWith("@/")
      ? resolve(root, "src", specifier.slice(2))
      : resolve(dirname(path), specifier);
    const target = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
    assert.ok(target, `Cannot resolve ${specifier} from ${file}`);
    return loadProductionModule(target);
  }
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions }).outputText;
  new Function("require", "module", "exports", compiled)(requireModule, module, module.exports);
  return module.exports;
}

export function loadPipeline(source) {
  const ast = tree(source);
  const constants = ["CATEGORY_MAP", "ODONATA_FAMILIES", "REA_SHAISH_NAME"]
    .map((name) => `const ${variable(ast, name).getText(ast)};`)
    .join("\n");
  const functions = ["getSupergroup", "parseObservedOn", "parseObservedTime", "parseMerlinRow"]
    .map((name) => functionText(ast, name))
    .join("\n");
  return evaluate(
    `${constants}\n${functions}
    return { parseObservedOn, parseObservedTime,
      load(observationsData, merlinData, userGroupMap) {
        const inat = ${variable(ast, "tziporiObservations").initializer.getText(ast)};
        const merlin = ${variable(ast, "merlinObservations").initializer.getText(ast)};
        return [...inat, ...merlin];
      }
    };`,
    loadProductionModule("src/lib/observation-enrichment.ts"),
  );
}
