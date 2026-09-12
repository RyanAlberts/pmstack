#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  validateProject,
  checkRun,
  generatePrompt,
  importDecision,
  decisionMarkdown,
  portablePacket,
} from '../docs/workspace/decision-engine.mjs';

const usage = `Usage:
  node bin/work-review.mjs prompt <project.json> <batch-id>
  node bin/work-review.mjs import <project.json> <batch-id> <decision.json> --system <name> --output <new-project.json>
  node bin/work-review.mjs check <project.json> [run-id]
  node bin/work-review.mjs brief <project.json> [run-id]

Import requires a new output file and never overwrites existing files.
Check exits 0 for accepted, 1 for unresolved work, and 2 for invalid input.
`;

function requireArgs(condition, message) {
  if (!condition) throw new Error(`${message}\n\n${usage}`);
}

async function readProject(path) {
  const project = JSON.parse(await readFile(path, 'utf8'));
  return validateProject(project);
}

function selectRun(project, id = project.activeRunId) {
  const run = project.runs.find(item => item.id === id);
  if (!run) throw new Error(`Run not found: ${id ?? '(no active run)'}`);
  return run;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--help' || command === '-h') {
    process.stdout.write(usage);
    return;
  }
  requireArgs(['prompt', 'import', 'check', 'brief'].includes(command), 'Choose a command.');

  if (command === 'prompt') {
    requireArgs(args.length === 2, 'Prompt requires a project and batch ID.');
    const project = await readProject(args[0]);
    process.stdout.write(`${generatePrompt(project, args[1])}\n`);
    return;
  }

  if (command === 'import') {
    requireArgs(args.length === 7, 'Import requires a project, batch, decision, system name, and new output path.');
    const [inputPath, batchId, decisionPath, ...flags] = args;
    const options = {};
    for (let index = 0; index < flags.length; index += 2) {
      const name = flags[index];
      const value = flags[index + 1];
      requireArgs(['--system', '--output'].includes(name) && !options[name] && value?.trim(), `Invalid import option: ${name}`);
      options[name] = value;
    }
    requireArgs(options['--system'] && options['--output'], 'Both --system and --output are required.');
    requireArgs(resolve(inputPath) !== resolve(options['--output']), 'Choose an output path different from the input project.');
    const project = await readProject(inputPath);
    const decision = await readFile(decisionPath, 'utf8');
    const imported = importDecision(project, batchId, decision, options['--system']);
    validateProject(imported);
    await writeFile(options['--output'], `${JSON.stringify(portablePacket(imported), null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`${JSON.stringify({ output: options['--output'], runId: imported.activeRunId, system: options['--system'] }, null, 2)}\n`);
    return;
  }

  requireArgs(args.length >= 1 && args.length <= 2, `${command} requires a project and optional run ID.`);
  const project = await readProject(args[0]);
  const run = selectRun(project, args[1]);
  if (command === 'brief') {
    process.stdout.write(`${decisionMarkdown(project, run.id)}\n`);
    return;
  }
  const result = checkRun(project, run);
  process.stdout.write(`${JSON.stringify({ runId: run.id, system: run.system, provenance: run.provenance, ...result }, null, 2)}\n`);
  if (result.status !== 'accepted') process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(`work-review: ${error.message}\n`);
  process.exitCode = 2;
});
