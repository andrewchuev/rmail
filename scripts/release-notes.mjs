#!/usr/bin/env node
// Prints Markdown release notes for <tag>, built from Conventional Commit subjects
// between the previous tag (or the optional <base> ref) and <tag>.
// Usage: node scripts/release-notes.mjs <tag> [base]
import { execFileSync } from "node:child_process";

const [tag, explicitBase] = process.argv.slice(2);
if (!tag) {
  console.error("Usage: node scripts/release-notes.mjs <tag> [base]");
  process.exit(1);
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function previousTag() {
  try {
    return git("describe", "--tags", "--abbrev=0", `${tag}^`);
  } catch {
    return null;
  }
}

const base = explicitBase ?? previousTag();
const range = base ? `${base}..${tag}` : tag;
const subjects = git("log", "--no-merges", "--pretty=format:%s", range).split("\n").filter(Boolean);

const sections = [
  [["feat"], "Features"],
  [["fix"], "Fixes"],
  [["perf"], "Performance"],
  [["refactor"], "Refactoring"],
  [["build", "ci"], "Build and release"],
  [["docs"], "Documentation"],
];
const sectionByType = new Map(sections.flatMap(([types, title]) => types.map((type) => [type, title])));
const grouped = new Map(sections.map(([, title]) => [title, []]));

for (const subject of subjects) {
  const match = /^(\w+)(?:\(([^)]+)\))?!?: (.+)$/.exec(subject);
  if (!match) continue;
  const [, type, scope, summary] = match;
  const title = sectionByType.get(type);
  if (!title) continue;
  grouped.get(title).push(scope ? `**${scope}:** ${summary}` : summary);
}

const lines = [];
for (const [, title] of sections) {
  const items = grouped.get(title);
  if (!items.length) continue;
  lines.push(`### ${title}`, "", ...items.map((item) => `- ${item}`), "");
}
if (!lines.length) lines.push("Maintenance release.", "");

if (base) {
  lines.push(`**Full changelog:** https://github.com/andrewchuev/rmail/compare/${base}...${tag}`, "");
}
console.log(lines.join("\n"));
