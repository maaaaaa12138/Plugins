#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");
const actions = new Set(["status", "install", "update", "uninstall"]);
const scopes = new Set(["global", "project"]);
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const hashPattern = /^[a-f0-9]{64}$/;
const actionNames = [
  "add",
  "update",
  "keep",
  "remove",
  "missing",
  "modified",
  "conflict",
];

export class UsageError extends Error {}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function parseArguments(argv, runtime = {}) {
  const action = argv[0];
  if (!actions.has(action)) {
    throw new UsageError("Action must be status, install, update, or uninstall");
  }

  const options = {
    action,
    scope: "global",
    project: null,
    dryRun: false,
    json: false,
    home: runtime.home ?? os.homedir(),
    bundleRoot: runtime.bundleRoot ?? pluginRoot,
  };

  const takeValue = (index, flag) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new UsageError(`${flag} requires a value`);
    }
    return value;
  };

  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--scope") {
      options.scope = takeValue(index, argument);
      index += 1;
    } else if (argument === "--project") {
      options.project = takeValue(index, argument);
      index += 1;
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--json") {
      options.json = true;
    } else {
      throw new UsageError(`Unknown argument: ${argument}`);
    }
  }

  if (!scopes.has(options.scope)) {
    throw new UsageError("--scope must be global or project");
  }
  if (options.scope === "project") {
    if (!options.project || !path.isAbsolute(options.project)) {
      throw new UsageError(
        "--scope project requires --project with an absolute path",
      );
    }
    options.project = path.resolve(options.project);
  } else if (options.project) {
    throw new UsageError("--project may be used only with --scope project");
  }
  if (!path.isAbsolute(options.home)) {
    throw new UsageError("The home directory must be an absolute path");
  }
  if (!path.isAbsolute(options.bundleRoot)) {
    throw new UsageError("The bundle root must be an absolute path");
  }

  return options;
}

function resolveLocations(options) {
  const scopeRoot =
    options.scope === "global" ? path.resolve(options.home) : options.project;
  const codexRoot = path.join(scopeRoot, ".codex");
  const targetDirectory = path.join(codexRoot, "agents");
  const stateFile = path.join(codexRoot, "agent-conductor-zh", "state.json");
  if (!isInside(scopeRoot, targetDirectory) || !isInside(scopeRoot, stateFile)) {
    throw new Error("Resolved management paths escape the selected scope");
  }
  return { scopeRoot, targetDirectory, stateFile };
}

function validateExistingDirectoryChain(scopeRoot, directory) {
  if (!path.isAbsolute(scopeRoot) || !isInside(scopeRoot, directory)) {
    throw new Error(`Directory escapes the selected scope: ${directory}`);
  }
  if (!fs.existsSync(scopeRoot)) {
    throw new Error(`Selected scope root does not exist: ${scopeRoot}`);
  }
  const rootInfo = fs.lstatSync(scopeRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error(`Selected scope root is not a regular directory: ${scopeRoot}`);
  }

  let current = path.resolve(scopeRoot);
  const relative = path.relative(current, path.resolve(directory));
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) break;
    const info = fs.lstatSync(current);
    if (info.isSymbolicLink()) {
      throw new Error(`Managed path contains a symbolic link or reparse point: ${current}`);
    }
    if (!info.isDirectory()) {
      throw new Error(`Managed path is not a regular directory: ${current}`);
    }
  }
}

function validateManagedPaths(locations) {
  validateExistingDirectoryChain(locations.scopeRoot, locations.targetDirectory);
  validateExistingDirectoryChain(
    locations.scopeRoot,
    path.dirname(locations.stateFile),
  );
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${label} ${file}: ${error.message}`);
  }
}

function validateBundle(bundleRoot) {
  const assetsRoot = path.resolve(bundleRoot, "assets");
  const agentsRoot = path.join(assetsRoot, "agents");
  const manifestFile = path.join(assetsRoot, "roles-manifest.json");
  if (!fs.existsSync(agentsRoot) || !fs.statSync(agentsRoot).isDirectory()) {
    throw new Error(`Bundled Agent directory does not exist: ${agentsRoot}`);
  }
  const agentsRootInfo = fs.lstatSync(agentsRoot);
  if (agentsRootInfo.isSymbolicLink()) {
    throw new Error("Bundled Agent directory must not be a symbolic link");
  }
  if (!fs.existsSync(manifestFile) || !fs.statSync(manifestFile).isFile()) {
    throw new Error(`Role manifest does not exist: ${manifestFile}`);
  }

  const manifest = readJson(manifestFile, "role manifest");
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.roles)) {
    throw new Error("Role manifest has an unsupported schema");
  }
  if (!Number.isInteger(manifest.roleCount) || manifest.roleCount !== manifest.roles.length) {
    throw new Error("Role manifest count does not match its roles array");
  }
  if (typeof manifest.pluginVersion !== "string" || !manifest.pluginVersion) {
    throw new Error("Role manifest is missing pluginVersion");
  }
  if (typeof manifest.roleBundleVersion !== "string" || !manifest.roleBundleVersion) {
    throw new Error("Role manifest is missing roleBundleVersion");
  }

  const realAgentsRoot = fs.realpathSync(agentsRoot);
  const seen = new Set();
  const roles = manifest.roles.map((role) => {
    if (!role || typeof role !== "object" || !slugPattern.test(role.slug ?? "")) {
      throw new Error("Role manifest contains an invalid slug");
    }
    if (seen.has(role.slug)) {
      throw new Error(`Role manifest contains duplicate slug: ${role.slug}`);
    }
    seen.add(role.slug);
    const expectedPath = `agents/${role.slug}.toml`;
    if (role.path !== expectedPath) {
      throw new Error(`Role path must be ${expectedPath}: ${role.slug}`);
    }
    if (!hashPattern.test(role.sha256 ?? "")) {
      throw new Error(`Role manifest contains an invalid hash: ${role.slug}`);
    }

    const sourceFile = path.resolve(assetsRoot, ...role.path.split("/"));
    if (!isInside(agentsRoot, sourceFile)) {
      throw new Error(`Bundled Agent path escapes assets/agents: ${role.slug}`);
    }
    if (!fs.existsSync(sourceFile)) {
      throw new Error(`Bundled Agent file is missing: ${role.slug}`);
    }
    const sourceInfo = fs.lstatSync(sourceFile);
    if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) {
      throw new Error(`Bundled Agent must be a regular file: ${role.slug}`);
    }
    const realSource = fs.realpathSync(sourceFile);
    if (!isInside(realAgentsRoot, realSource)) {
      throw new Error(`Bundled Agent resolves outside assets/agents: ${role.slug}`);
    }
    const content = fs.readFileSync(sourceFile);
    const computedHash = sha256(content);
    if (computedHash !== role.sha256) {
      throw new Error(
        `Source hash mismatch for ${role.slug}: expected ${role.sha256}, got ${computedHash}`,
      );
    }
    return {
      slug: role.slug,
      sourceFile,
      sourceHash: computedHash,
      content,
    };
  });

  return { manifest, roles };
}

function validateStateRecord(slug, record) {
  if (!slugPattern.test(slug) || !record || typeof record !== "object") {
    throw new Error(`Managed state contains an invalid role: ${slug}`);
  }
  if (record.fileName !== `${slug}.toml`) {
    throw new Error(`Managed state contains an invalid file name: ${slug}`);
  }
  if (!hashPattern.test(record.installedHash ?? "")) {
    throw new Error(`Managed state contains an invalid installed hash: ${slug}`);
  }
  if (!hashPattern.test(record.sourceHash ?? "")) {
    throw new Error(`Managed state contains an invalid source hash: ${slug}`);
  }
}

function readState(stateFile, options, targetDirectory) {
  if (!fs.existsSync(stateFile)) return { state: null, hash: null };
  const stateInfo = fs.lstatSync(stateFile);
  if (!stateInfo.isFile() || stateInfo.isSymbolicLink()) {
    throw new Error(`Managed state is not a regular file: ${stateFile}`);
  }
  const content = fs.readFileSync(stateFile);
  let state;
  try {
    state = JSON.parse(content.toString("utf8"));
  } catch (error) {
    throw new Error(`Unable to read managed state ${stateFile}: ${error.message}`);
  }
  if (
    state.schemaVersion !== 1 ||
    state.scope !== options.scope ||
    path.resolve(state.targetDirectory ?? "") !== path.resolve(targetDirectory) ||
    !state.files ||
    typeof state.files !== "object" ||
    Array.isArray(state.files)
  ) {
    throw new Error("Managed state does not match the selected scope");
  }
  for (const [slug, record] of Object.entries(state.files)) {
    validateStateRecord(slug, record);
  }
  return { state, hash: sha256(content) };
}

function assertStateUnchanged(stateFile, expectedHash) {
  if (!fs.existsSync(stateFile)) {
    if (expectedHash !== null) {
      throw new Error("Managed state changed during operation: state file disappeared");
    }
    return;
  }
  const info = fs.lstatSync(stateFile);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error("Managed state changed during operation: state is not a regular file");
  }
  const currentHash = sha256(fs.readFileSync(stateFile));
  if (expectedHash === null || currentHash !== expectedHash) {
    throw new Error("Managed state changed during operation: content hash mismatch");
  }
}

function inspectTarget(file) {
  if (!fs.existsSync(file)) return { exists: false, hash: null, regular: true };
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) {
    return { exists: true, hash: null, regular: false };
  }
  return { exists: true, hash: sha256(fs.readFileSync(file)), regular: true };
}

function actionRecord(slug, action, reason, details = {}) {
  return {
    slug,
    action,
    reason,
    sourceHash: details.sourceHash ?? null,
    currentHash: details.currentHash ?? null,
    managedHash: details.managedHash ?? null,
  };
}

function planCurrentRole(operation, role, record, destination) {
  const current = inspectTarget(destination);
  const details = {
    sourceHash: role.sourceHash,
    currentHash: current.hash,
    managedHash: record?.installedHash,
  };

  if (operation === "status") {
    if (!record) {
      if (!current.exists) {
        return actionRecord(role.slug, "missing", "role is not installed", details);
      }
      return actionRecord(
        role.slug,
        "conflict",
        current.regular ? "destination exists but is not managed" : "destination is not a regular file",
        details,
      );
    }
    if (!current.exists) {
      return actionRecord(role.slug, "missing", "managed destination is missing", details);
    }
    if (!current.regular || current.hash !== record.installedHash) {
      return actionRecord(role.slug, "modified", "managed destination was modified", details);
    }
    if (current.hash !== role.sourceHash) {
      return actionRecord(role.slug, "update", "a bundled update is available", details);
    }
    return actionRecord(role.slug, "keep", "managed destination is current", details);
  }

  if (!current.exists) {
    return actionRecord(role.slug, "add", "destination is absent", details);
  }
  if (!record) {
    return actionRecord(
      role.slug,
      "conflict",
      current.regular ? "destination exists but is not managed" : "destination is not a regular file",
      details,
    );
  }
  if (!current.regular || current.hash !== record.installedHash) {
    return actionRecord(role.slug, "conflict", "managed destination was modified", details);
  }
  if (current.hash === role.sourceHash) {
    return actionRecord(role.slug, "keep", "managed destination is current", details);
  }
  return actionRecord(role.slug, "update", "managed destination can be updated", details);
}

function planUninstall(state, targetDirectory) {
  if (!state) return [];
  return Object.entries(state.files)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([slug, record]) => {
      const destination = path.join(targetDirectory, `${slug}.toml`);
      const current = inspectTarget(destination);
      const details = {
        sourceHash: record.sourceHash,
        currentHash: current.hash,
        managedHash: record.installedHash,
      };
      if (!current.exists) {
        return actionRecord(slug, "missing", "managed destination is already absent", details);
      }
      if (!current.regular || current.hash !== record.installedHash) {
        return actionRecord(slug, "conflict", "modified managed destination is preserved", details);
      }
      return actionRecord(slug, "remove", "unmodified managed destination can be removed", details);
    });
}

function buildPlan(options, bundle, state, targetDirectory) {
  if (options.action === "uninstall") {
    return planUninstall(state, targetDirectory);
  }

  const plan = bundle.roles.map((role) => {
    const record = state?.files?.[role.slug] ?? null;
    const destination = path.join(targetDirectory, `${role.slug}.toml`);
    return planCurrentRole(options.action, role, record, destination);
  });

  if (options.action === "update" && state) {
    const bundledSlugs = new Set(bundle.roles.map((role) => role.slug));
    for (const [slug, record] of Object.entries(state.files)) {
      if (bundledSlugs.has(slug)) continue;
      const destination = path.join(targetDirectory, `${slug}.toml`);
      const current = inspectTarget(destination);
      const details = {
        sourceHash: null,
        currentHash: current.hash,
        managedHash: record.installedHash,
      };
      if (!current.exists) {
        plan.push(actionRecord(slug, "missing", "retired managed role is already absent", details));
      } else if (current.regular && current.hash === record.installedHash) {
        plan.push(actionRecord(slug, "remove", "retired unmodified managed role can be removed", details));
      } else {
        plan.push(actionRecord(slug, "conflict", "modified retired role is preserved", details));
      }
    }
  }

  return plan;
}

function ensureSafeDirectory(scopeRoot, directory) {
  if (!path.isAbsolute(scopeRoot) || !isInside(scopeRoot, directory)) {
    throw new Error(`Directory escapes the selected scope: ${directory}`);
  }
  if (!fs.existsSync(scopeRoot)) {
    throw new Error(`Selected scope root does not exist: ${scopeRoot}`);
  }
  const rootInfo = fs.lstatSync(scopeRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error(`Selected scope root is not a regular directory: ${scopeRoot}`);
  }

  let current = path.resolve(scopeRoot);
  const relative = path.relative(current, path.resolve(directory));
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (fs.existsSync(current)) {
      const info = fs.lstatSync(current);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error(`Managed directory path is not a regular directory: ${current}`);
      }
    } else {
      fs.mkdirSync(current);
    }
  }
}

function atomicWrite(file, content, expectedHash, expectedCurrentHash) {
  const current = inspectTarget(file);
  if (expectedCurrentHash === null) {
    if (current.exists) throw new Error(`Destination appeared during operation: ${file}`);
  } else if (!current.regular || current.hash !== expectedCurrentHash) {
    throw new Error(`Destination changed during operation: ${file}`);
  }

  const tempFile = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(tempFile, content, { flag: "wx", mode: 0o600 });
    const tempHash = sha256(fs.readFileSync(tempFile));
    if (tempHash !== expectedHash) {
      throw new Error(`Temporary file hash mismatch: ${file}`);
    }
    fs.renameSync(tempFile, file);
    if (sha256(fs.readFileSync(file)) !== expectedHash) {
      throw new Error(`Installed file hash mismatch: ${file}`);
    }
  } finally {
    if (fs.existsSync(tempFile)) fs.rmSync(tempFile, { force: true });
  }
}

function makeState(options, bundle, targetDirectory, previousState, plan, operationId) {
  const files = { ...(previousState?.files ?? {}) };
  const roleBySlug = new Map(bundle.roles.map((role) => [role.slug, role]));
  const timestamp = new Date().toISOString();

  for (const item of plan) {
    const role = roleBySlug.get(item.slug);
    if (item.action === "add" || item.action === "update") {
      files[item.slug] = {
        fileName: `${item.slug}.toml`,
        sourceHash: role.sourceHash,
        installedHash: role.sourceHash,
        installedAt: timestamp,
        operationId,
      };
    } else if (item.action === "keep" && role && files[item.slug]) {
      files[item.slug] = { ...files[item.slug], sourceHash: role.sourceHash };
    } else if (item.action === "remove" || item.action === "missing") {
      delete files[item.slug];
    }
  }

  return {
    schemaVersion: 1,
    pluginVersion: bundle.manifest.pluginVersion,
    roleBundleVersion: bundle.manifest.roleBundleVersion,
    scope: options.scope,
    targetDirectory: path.resolve(targetDirectory),
    updatedAt: timestamp,
    operationId,
    files,
  };
}

function applyPlan(options, locations, bundle, state, stateHash, plan) {
  const mutating = plan.filter((item) =>
    new Set(["add", "update", "remove"]).has(item.action),
  );
  const clearsMissingOwnership =
    options.action === "uninstall" || options.action === "update";
  const missingOwned = clearsMissingOwnership
    ? plan.filter((item) => item.action === "missing" && state?.files?.[item.slug])
    : [];
  const wouldChange = mutating.length > 0 || missingOwned.length > 0;
  if (options.action === "status") return false;
  if (options.dryRun || !wouldChange) {
    return wouldChange;
  }

  validateManagedPaths(locations);
  assertStateUnchanged(locations.stateFile, stateHash);

  const roleBySlug = new Map(bundle.roles.map((role) => [role.slug, role]));
  if (mutating.some((item) => item.action === "add" || item.action === "update")) {
    ensureSafeDirectory(locations.scopeRoot, locations.targetDirectory);
  }

  for (const item of mutating) {
    const destination = path.join(locations.targetDirectory, `${item.slug}.toml`);
    if (item.action === "remove") {
      const current = inspectTarget(destination);
      if (!current.regular || current.hash !== item.managedHash) {
        throw new Error(`Destination changed before removal: ${destination}`);
      }
      fs.rmSync(destination);
      continue;
    }
    const role = roleBySlug.get(item.slug);
    atomicWrite(destination, role.content, role.sourceHash, item.currentHash);
  }

  const operationId = crypto.randomUUID();
  const nextState = makeState(
    options,
    bundle,
    locations.targetDirectory,
    state,
    plan,
    operationId,
  );
  if (options.action === "uninstall" && Object.keys(nextState.files).length === 0) {
    assertStateUnchanged(locations.stateFile, stateHash);
    if (fs.existsSync(locations.stateFile)) fs.rmSync(locations.stateFile);
    return true;
  }

  ensureSafeDirectory(locations.scopeRoot, path.dirname(locations.stateFile));
  const serialized = Buffer.from(`${JSON.stringify(nextState, null, 2)}\n`, "utf8");
  assertStateUnchanged(locations.stateFile, stateHash);
  atomicWrite(
    locations.stateFile,
    serialized,
    sha256(serialized),
    stateHash,
  );
  return true;
}

function summarize(options, locations, bundle, state, plan, changed) {
  const actionCounts = Object.fromEntries(actionNames.map((name) => [name, 0]));
  for (const item of plan) actionCounts[item.action] += 1;
  return {
    action: options.action,
    scope: options.scope,
    dryRun: options.dryRun,
    bundleRoleCount: bundle.roles.length,
    bundleVersion: bundle.manifest.roleBundleVersion,
    installedBundleVersion: state?.roleBundleVersion ?? null,
    targetDirectory: locations.targetDirectory,
    stateFile: locations.stateFile,
    actionCounts,
    actions: plan,
    changed,
  };
}

function printResult(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `${result.action} (${result.scope})${result.dryRun ? " [dry run]" : ""}\n`,
  );
  process.stdout.write(`Target: ${result.targetDirectory}\n`);
  for (const name of actionNames) {
    if (result.actionCounts[name] > 0) {
      process.stdout.write(`${name}: ${result.actionCounts[name]}\n`);
    }
  }
}

export function executeManager(argv, runtime = {}) {
  const options = parseArguments(argv, runtime);
  const locations = resolveLocations(options);
  const bundle = validateBundle(options.bundleRoot);
  validateManagedPaths(locations);
  const stateSnapshot = readState(
    locations.stateFile,
    options,
    locations.targetDirectory,
  );
  const state = stateSnapshot.state;
  const plan = buildPlan(options, bundle, state, locations.targetDirectory);
  runtime.beforeApply?.({ options, locations, bundle, state, plan });
  const changed = applyPlan(
    options,
    locations,
    bundle,
    state,
    stateSnapshot.hash,
    plan,
  );
  return summarize(options, locations, bundle, state, plan, changed);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = executeManager(process.argv.slice(2));
    printResult(result, process.argv.includes("--json"));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(error instanceof UsageError ? 2 : 1);
  }
}
