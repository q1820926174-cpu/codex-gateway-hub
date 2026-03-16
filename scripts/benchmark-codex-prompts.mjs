#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_MODELS = ["gpt-5.4", "gpt-5.3-codex"];
const DEFAULT_SANDBOX = "workspace-write";
const DEFAULT_PROMPT =
  "请在当前目录完成三步：1) 创建 probe_codex.txt，内容为 hello；2) 将其改为 hello world；3) 删除该文件。禁止只输出 patch 文本，必须真实执行。完成后只输出 DONE。";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith("--")) {
      continue;
    }
    const [rawKey, inlineValue] = current.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      args[rawKey] = inlineValue;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[rawKey] = "true";
      continue;
    }
    args[rawKey] = next;
    i += 1;
  }
  return args;
}

function sanitizeName(input) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
}

function runCommand(cmd, args, cwd) {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8"
  });
  if (result.status === 0) {
    return;
  }
  const detail = [
    `Command failed: ${cmd} ${args.join(" ")}`,
    `cwd: ${cwd}`,
    `status: ${result.status}`,
    result.stdout ? `stdout:\n${result.stdout}` : "",
    result.stderr ? `stderr:\n${result.stderr}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
  throw new Error(detail);
}

function parseTokensUsed(text) {
  const match = text.match(/tokens used\s*\n\s*([0-9,]+)/i);
  if (!match) {
    return null;
  }
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function createMarkdownReport(summary) {
  const lines = [];
  lines.push("# Codex Prompt Benchmark");
  lines.push("");
  lines.push(`- Timestamp: ${summary.timestamp}`);
  lines.push(`- Prompt: ${summary.prompt}`);
  lines.push(`- Sandbox: ${summary.sandbox}`);
  lines.push(`- Output directory: ${summary.outputDir}`);
  lines.push("");
  lines.push("| Model | Exit | Final | Probe Deleted | Tokens | apply_patch | shell exec | fake patch text |");
  lines.push("| --- | ---: | --- | --- | ---: | --- | --- | --- |");
  for (const row of summary.results) {
    lines.push(
      `| ${row.model} | ${row.exitCode} | ${row.finalMessage || "(empty)"} | ${row.probeDeleted ? "yes" : "no"} | ${row.tokensUsed ?? "n/a"} | ${row.usedApplyPatch ? "yes" : "no"} | ${row.usedShellExec ? "yes" : "no"} | ${row.leakedPatchText ? "yes" : "no"} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  const models = (args.models || DEFAULT_MODELS.join(","))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!models.length) {
    throw new Error("No models provided. Use --models.");
  }

  const codexBin = args["codex-bin"] || process.env.CODEX_BIN || "codex";
  const sandbox = args.sandbox || DEFAULT_SANDBOX;
  const prompt = args.prompt || DEFAULT_PROMPT;
  const timestamp = new Date().toISOString().replace(/[:]/g, "-");
  const outDir = path.resolve(
    args["out-dir"] || path.join(process.cwd(), ".tmp", "codex-bench", timestamp)
  );

  fs.mkdirSync(outDir, { recursive: true });
  const results = [];

  for (const model of models) {
    const modelSlug = sanitizeName(model) || "model";
    const modelDir = path.join(outDir, modelSlug);
    fs.rmSync(modelDir, { recursive: true, force: true });
    fs.mkdirSync(modelDir, { recursive: true });

    fs.writeFileSync(path.join(modelDir, "README.md"), "# probe\n", "utf8");
    runCommand("git", ["init", "-q"], modelDir);
    runCommand("git", ["add", "README.md"], modelDir);
    runCommand("git", ["commit", "-q", "-m", "init"], modelDir);

    const lastMessagePath = path.join(modelDir, "last.txt");
    const startedAt = Date.now();
    const execResult = spawnSync(
      codexBin,
      ["exec", "-s", sandbox, "-C", modelDir, "-m", model, "-o", lastMessagePath, prompt],
      {
        encoding: "utf8"
      }
    );
    const elapsedMs = Date.now() - startedAt;

    const stdout = execResult.stdout || "";
    const stderr = execResult.stderr || "";
    const combined = `${stdout}\n${stderr}`;
    fs.writeFileSync(path.join(modelDir, "stdout.log"), stdout, "utf8");
    fs.writeFileSync(path.join(modelDir, "stderr.log"), stderr, "utf8");

    const finalMessage = fs.existsSync(lastMessagePath)
      ? fs.readFileSync(lastMessagePath, "utf8").trim()
      : "";

    results.push({
      model,
      exitCode: execResult.status ?? -1,
      elapsedMs,
      finalMessage,
      probeDeleted: !fs.existsSync(path.join(modelDir, "probe_codex.txt")),
      tokensUsed: parseTokensUsed(combined),
      usedApplyPatch: /apply_patch\(/i.test(combined),
      usedShellExec: /\nexec\n\/bin\/bash -lc /i.test(combined),
      leakedPatchText:
        /\*\*\* Begin Patch/i.test(combined) || /\*\*\* Begin Patch/i.test(finalMessage)
    });
  }

  const summary = {
    timestamp: new Date().toISOString(),
    prompt,
    sandbox,
    outputDir: outDir,
    results
  };

  const jsonPath = path.join(outDir, "report.json");
  const mdPath = path.join(outDir, "report.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, createMarkdownReport(summary), "utf8");

  process.stdout.write(`Benchmark complete.\nreport.json: ${jsonPath}\nreport.md: ${mdPath}\n`);
}

main();
