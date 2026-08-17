#!/usr/bin/env node
// Bumps the patch version across every file that records it and keeps them
// in sync: package.json, package-lock.json, src-tauri/tauri.conf.json,
// src-tauri/Cargo.toml, src-tauri/Cargo.lock. Major/minor stay manual - only
// the patch number is incremented, once per release build.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function bumpPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Unrecognized semver version "${version}" in package.json`);
  }
  const [, major, minor, patch] = match;
  return `${major}.${minor}.${Number(patch) + 1}`;
}

// Replaces `pattern` (a literal string, matched exactly `expectedCount` times)
// with `replacement` in the given file. Failing to find the expected number
// of matches means the file is out of sync with package.json, so this throws
// rather than silently bumping the wrong thing (or an unrelated dependency
// that happens to share the same version number in a lockfile).
function replaceExact(path, pattern, replacement, expectedCount = 1) {
  const text = readFileSync(path, "utf8");
  const occurrences = text.split(pattern).length - 1;
  if (occurrences !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} occurrence(s) of ${JSON.stringify(pattern)} in ${path}, found ${occurrences}. Files may be out of sync - fix versions manually and retry.`,
    );
  }
  writeFileSync(path, text.split(pattern).join(replacement));
}

const packageJsonPath = join(root, "package.json");
const currentVersion = JSON.parse(readFileSync(packageJsonPath, "utf8")).version;
const nextVersion = bumpPatch(currentVersion);

replaceExact(packageJsonPath, `"version": "${currentVersion}"`, `"version": "${nextVersion}"`);

replaceExact(
  join(root, "package-lock.json"),
  `"name": "rmail",\n  "version": "${currentVersion}"`,
  `"name": "rmail",\n  "version": "${nextVersion}"`,
);
replaceExact(
  join(root, "package-lock.json"),
  `"name": "rmail",\n      "version": "${currentVersion}"`,
  `"name": "rmail",\n      "version": "${nextVersion}"`,
);

replaceExact(
  join(root, "src-tauri", "tauri.conf.json"),
  `"version": "${currentVersion}"`,
  `"version": "${nextVersion}"`,
);

replaceExact(
  join(root, "src-tauri", "Cargo.toml"),
  `name = "rmail"\nversion = "${currentVersion}"`,
  `name = "rmail"\nversion = "${nextVersion}"`,
);
replaceExact(
  join(root, "src-tauri", "Cargo.lock"),
  `name = "rmail"\nversion = "${currentVersion}"`,
  `name = "rmail"\nversion = "${nextVersion}"`,
);

console.log(`Version bumped: ${currentVersion} -> ${nextVersion}`);
