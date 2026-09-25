# pmstack skills

Twelve skills that walk an AI agent through error discovery: read real traces, name the failure modes, and turn the ones that matter into checks you can trust. Each skill is a folder with a `SKILL.md` file (plain Markdown with a short header), so any agent that reads skills can use them.

| Skill | Use it when | In Claude Code |
|---|---|---|
| `pmstack-start` | You are not sure where to begin | `/pmstack:start` |
| `pmstack-find-failures` | You have traces and want to find how the product fails | `/pmstack:find-failures` |
| `pmstack-make-traces` | You have no real traces yet | `/pmstack:make-traces` |
| `pmstack-build-judge` | A failure mode needs an AI judge | `/pmstack:build-judge` |
| `pmstack-test-judge` | You need to know whether a judge agrees with you | `/pmstack:test-judge` |
| `pmstack-check-sources` | Your product answers questions by searching documents | `/pmstack:check-sources` |
| `pmstack-custom-view` | Your traces do not look the way your customer saw them | `/pmstack:custom-view` |
| `pmstack-evals-checkup` | You inherited evals and want to know if the numbers hold up | `/pmstack:evals-checkup` |
| `pmstack-regression-checks` | You want checks to run on every code change and in production | `/pmstack:regression-checks` |
| `pmstack-tool-policy` | Your agent's tool calls must follow company rules (policy: is this call allowed?) | `/pmstack:tool-policy` |
| `pmstack-tool-relevance` | Your agent picks the wrong tool or details (relevance: is it the right call for what the customer asked?) | `/pmstack:tool-relevance` |
| `pmstack-tool-grounding` | Your agent's replies don't match its tool results (output grounding: does the reply match what the tool returned?) | `/pmstack:tool-grounding` |

Several skills run the pmstack command-line tool (`bin/pmstack.mjs`, which needs Node 20 or newer and nothing else). They look for it in three places: the `.pmstack/` folder that `setup` creates, the plugin's own folder, and `~/.pmstack/`. When they find none, they send you to [Eval Studio on the web](https://ryanalberts.github.io/pmstack/studio/) instead.

The three tool call skills also read the ready-to-copy files in [`templates/tool-calls/`](../templates/tool-calls/): a worked enterprise policy, a starter policy, the policy requirements checklist, an intent map, and two AI judge prompts. They look for that folder next to the command-line tool, and read it on GitHub when it is not on your computer.

## Claude Code

**As a plugin** (skills, commands, and the tool in one step):

```
/plugin marketplace add RyanAlberts/pmstack
/plugin install pmstack@pmstack
```

Then run `/pmstack:start`.

**With setup** (copies files into one project, or into your home folder with `--global`):

```sh
curl -fsSL https://raw.githubusercontent.com/RyanAlberts/pmstack/main/install.sh | bash -s -- /path/to/your/project
```

Or from a clone:

```sh
git clone https://github.com/RyanAlberts/pmstack
cd pmstack
./setup /path/to/your/project   # skills to .claude/skills/, the tool to .pmstack/
./setup --global                # skills to ~/.claude/skills/, the tool to ~/.pmstack/
./setup --dry-run               # show what would be copied
```

Setup never touches your `CLAUDE.md`, and running it again replaces pmstack's files with the new ones. Skills installed this way run as `/pmstack-start`, `/pmstack-find-failures`, and so on.

## Codex, Cursor, and Gemini CLI

First put the tool in your home folder, then copy the skill folders where your agent looks for skills:

```sh
git clone https://github.com/RyanAlberts/pmstack
cd pmstack
./setup --global   # the tool goes to ~/.pmstack/ (Claude Code skills go to ~/.claude/skills/ too)
```

| Agent | For every project | For one project |
|---|---|---|
| Codex | `cp -R skills/pmstack-* ~/.agents/skills/` | `cp -R skills/pmstack-* /path/to/project/.agents/skills/` |
| Cursor | `cp -R skills/pmstack-* ~/.cursor/skills/` | `cp -R skills/pmstack-* /path/to/project/.cursor/skills/` |
| Gemini CLI | `cp -R skills/pmstack-* ~/.gemini/skills/` | `cp -R skills/pmstack-* /path/to/project/.gemini/skills/` |

Create the folder first if it does not exist (`mkdir -p`). In Gemini CLI, `gemini skills list` confirms they loaded. For a single project, you can instead run `./setup /path/to/project` to put the tool in that project's `.pmstack/` folder.

## Any other agent

Copy the `pmstack-*` folders into the folder your agent reads skills from, or paste a `SKILL.md` into its instructions. Keep each folder whole: `pmstack-find-failures` includes a second file, `reviewing-traces.md`. Run `./setup --global` once so the skills can find the tool in `~/.pmstack/`.

## Claude on the web (claude.ai)

Zip one skill folder and upload it in the Skills section of Claude's settings:

```sh
cd skills
zip -r pmstack-start.zip pmstack-start
```

Repeat for each skill you want. The web version cannot run the command-line tool, so these skills use [Eval Studio on the web](https://ryanalberts.github.io/pmstack/studio/) and its AI help drawer instead.
