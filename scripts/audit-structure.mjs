import { readFileSync, readdirSync } from "node:fs";
import { extname, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE_ROOTS = [resolve(ROOT, "src"), resolve(ROOT, "src-tauri/src")];
const LINE_LIMITS = new Map([
  [".ts", 600],
  [".vue", 700],
  [".rs", 1200],
  [".scss", 700]
]);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

function lineCount(content) {
  return content === "" ? 0 : content.split(/\r?\n/u).length;
}

function checkVueOrder(path, content, errors) {
  const script = content.search(/^<script(?:\s|>)/mu);
  const template = content.search(/^<template(?:\s|>)/mu);
  const style = content.search(/^<style(?:\s|>)/mu);
  if (script < 0 || template < 0 || style < 0 || !(script < template && template < style)) {
    errors.push(`${relative(ROOT, path)}：SFC 必须按 script、template、style 排列`);
  }
}

function checkNaming(path, errors) {
  const projectPath = relative(ROOT, path);
  const fileName = projectPath.split("/").at(-1) ?? "";
  if (projectPath.startsWith("src/components/") && fileName.endsWith(".vue")) {
    if (!/^[A-Z][A-Za-z0-9]*\.vue$/u.test(fileName)) {
      errors.push(`${projectPath}：Vue 组件文件名应使用 PascalCase`);
    }
  }
  if (projectPath.startsWith("src/views/") && !/^[A-Z][A-Za-z0-9]*View\.vue$/u.test(fileName)) {
    errors.push(`${projectPath}：路由视图文件名应以 View.vue 结尾`);
  }
  if (projectPath.startsWith("src/composables/") && fileName.endsWith(".ts") && !fileName.includes(".test.")) {
    if (!/^use[A-Z][A-Za-z0-9]*\.ts$/u.test(fileName)) {
      errors.push(`${projectPath}：composable 文件名应以 use 开头`);
    }
  }
}

const errors = [];
const oversized = [];

for (const path of SOURCE_ROOTS.flatMap(sourceFiles)) {
  const extension = extname(path);
  if (!LINE_LIMITS.has(extension)) continue;
  const content = readFileSync(path, "utf8");
  const lines = lineCount(content);
  const projectPath = relative(ROOT, path);

  checkNaming(path, errors);
  if (extension === ".vue") checkVueOrder(path, content, errors);
  if (!projectPath.includes(".test.") && lines > LINE_LIMITS.get(extension)) {
    oversized.push({ path: projectPath, lines, limit: LINE_LIMITS.get(extension) });
  }
}

if (oversized.length) {
  console.warn("以下文件超过建议规模，请在相关需求中优先按职责拆分：");
  oversized
    .sort((left, right) => right.lines - left.lines)
    .forEach(({ path, lines, limit }) => console.warn(`- ${path}: ${lines} 行（建议不超过 ${limit}）`));
}

if (errors.length) {
  console.error("结构检查失败：");
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(`结构检查通过；发现 ${oversized.length} 个待拆分的大文件。`);
}
