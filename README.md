# staffer

*A chief of staff for your Claude Code sessions.*

[![CI](https://github.com/sergionahas/staffer/actions/workflows/ci.yml/badge.svg)](https://github.com/sergionahas/staffer/actions/workflows/ci.yml)
[![Secret scan](https://github.com/sergionahas/staffer/actions/workflows/secrets.yml/badge.svg)](https://github.com/sergionahas/staffer/actions/workflows/secrets.yml)

**Run a project as parallel Claude Code sessions, managed from one chat.** Hand the PM five tickets; it staffs each one with its own worker in cmux, keeps an eye on them, tells you in one line when each is done or stuck, and tidies up after them.

```bash
npx staffer init
```

You talk to a single **PM** session. It never does the work itself. For each ticket it starts a **worker**: a separate Claude Code session in its own [cmux](https://cmux.dev) workspace. When a worker finishes or gets stuck, it prints one `STATUS:` line, and a small watcher types that line into the PM's chat. The PM answers in one line ("ABC-153 done: <PR url>") and closes the worker. An overview pane next to the PM shows everything at a glance.

## How it looks

```
┌─ ADMIN ───────────────────────────────────────┬───────────────────────────────────────┐
│ ADMIN · My project sessions · 14:02:11        │ > start ABC-153 and ABC-154           │
│ USAGE Claude plan limits                      │ Started ABC-153 (market module) and   │
│   Session 5h   ████████░░░░░░░░ 41% resets in │ ABC-154 (exports).                    │
│   Week all     ███░░░░░░░░░░░░░ 18% resets Mon│                                       │
│                                               │ [worker ABC-153] DONE https://github… │
│ SESSIONS 2 working · 0 blocked · 1 done       │ ABC-153 done: https://github.com/…/12 │
│   ● ABC-154 Exports busy 12m · 1.2M tok       │ Closed ABC-153.                       │
│   ✓ ABC-150 Fix login 40m                     │                                       │
│       https://github.com/acme/app/pull/11     │                                       │
│                                               │                                       │
│ RECENT                                        │                                       │
│   2m  DONE ABC-153: https://github.com/…      │                                       │
│                                               │                                       │
│ OPEN PRs app, api                             │                                       │
│   app#12 Market module 3m                     │                                       │
│                                               │                                       │
│ DONE · last 24h · 1                           │                                       │
│   ✓ 1m  ABC-153  Market module                │                                       │
│       https://github.com/acme/app/pull/12     │                                       │
└───────────────────────────────────────────────┴───────────────────────────────────────┘
   Overview (overview.mjs + watch.mjs)             PM (Claude Code with the PM skill)

   Each worker runs in its own cmux workspace: "ABC-154 · Exports", "ABC-150 · Fix login", …
```

- **Overview** (left): your Claude plan limits as bars (the numbers `/usage` shows), every open worker with its last report and token count, recent events, open PRs on your repos, and what was closed in the last 24 hours.
- **PM** (right): Claude Code with a generated PM skill. You ask it to start work; it writes a task prompt and runs `spawn.sh`. It replies in one line each time.
- **Workers**: one cmux workspace per ticket. Each gets its task plus your shared worker rules, and ends with `STATUS: DONE <PR url>` or `STATUS: BLOCKED <question>`.

## Requirements

- macOS with [cmux](https://cmux.dev) (the CLI is found at `/Applications/cmux.app/Contents/Resources/bin/cmux`; change `cmuxBin` in the config if yours is elsewhere)
- [Claude Code](https://claude.com/claude-code), logged in with a Claude subscription (the usage bars need it)
- Node.js 20.12 or newer
- [GitHub CLI](https://cli.github.com) (`gh`), logged in, for the open-PRs list and for workers opening PRs
- `python3` (used by the layout script; macOS has it)

## Setup

Run this from a cmux terminal:

```bash
npx staffer init
```

or straight from GitHub, `npx github:sergionahas/staffer init`, or from a clone:

```bash
git clone https://github.com/sergionahas/staffer.git && ./staffer/install.sh
```

It lists the projects it finds and you pick one with the arrow keys (or type to filter):

```
◆  Which project?
│  ● goliath        ~/goliath · 10 repos · 2h ago
│  ○ trackora       ~/trackora · you/trackora · 3d ago
│  ○ + Other folder…
```

A project is a folder that is a git repo or holds git repos one level down. By default it looks at the folders in `~`; set other places with `--roots ~/code,~/work` or `STAFFER_ROOTS`. Projects already set up come first, marked `✓ staffer`, then the most recently touched.

Then it fills in what it can detect and asks you to confirm: the GitHub repos to watch (all checked), where tickets live, the ticket prefix (guessed from branch names like `abc-123-…`), what the PM calls you (from your GitHub name), and whether to open the PM in a new cmux workspace, this one, or not now. Then it:

1. copies the tooling into a PM directory (default `<workdir>/.staffer/`),
2. writes `staffer.config.json` and `worker-rules.md` there,
3. installs the PM skill as `~/.claude/skills/<project>-pm/SKILL.md`, filled in from the config,
4. opens the PM workspace in cmux (overview left, PM right), where you chose.

Every question has a flag, and a flag skips its question. With `--yes` (or without a terminal) nothing is asked: it uses the flags, an existing config and defaults, in the current folder, and builds the layout in the current workspace, as before:

```bash
npx staffer init --yes --workdir ~/acme --project Acme \
  --repos acme/app,acme/api --prefix ABC --tracker "Linear (the linear MCP server)" --owner Sam
```

Then open `worker-rules.md` and fill in the **Repo rules** section: where workers clone, what to read first, which checks must pass. It's appended to every worker's prompt.

Rerun `init` any time: it upgrades the tooling and re-renders the skill from `staffer.config.json`, and keeps your config, worker rules and state. Older installs used `pm.config.json`; it's still read, and `init` renames it.

### staffer.config.json

| Key | What |
|---|---|
| `project` | Name shown in the overview and used in the skill |
| `workdir` | Where the PM and workers start |
| `repos` | `owner/repo` list for the OPEN PRs section |
| `ticketPrefix` | `ABC` for tickets like `ABC-123`. Used to spot tickets in workspace names |
| `tracker` | Where tickets live, in words; the PM and workers are told to read and update them there |
| `owner` | What the PM calls you |
| `skill` | Name of the installed PM skill |
| `workspaceName` | Name of the cmux workspace (default `ADMIN`) |
| `workerRules` | Rules file appended to each worker's prompt (default `worker-rules.md`) |
| `claudeArgs` | Extra arguments for every `claude` started (default: `--permission-mode bypassPermissions`) |
| `cmuxBin` | Path to the cmux CLI |

> **Permissions:** by default the PM and workers run with `--permission-mode bypassPermissions`, so they work without stopping to ask. They can run any command your user can. Change `claudeArgs` if you want them to ask.

## Use

Talk to the PM:

- "Start ABC-153 and ABC-154." → `Started ABC-153 (market module) and ABC-154 (exports).`
- "How is ABC-154 going?" → it reads that worker's screen and answers in one line.
- A worker finishes → `[worker ABC-153] DONE https://…` appears in the PM chat → `ABC-153 done: https://…`, and the PM closes it.
- A worker is blocked → the PM asks you its one question; your answer goes back to the worker.

You can also run the scripts yourself (from the PM directory):

```bash
./cmux.sh                               # rebuild the layout in this cmux workspace
./cmux.sh --new                         # ...or in a new workspace
./spawn.sh ABC-123 "Short title" task.md   # start a worker on task.md (+ worker-rules.md)
./spawn.sh --no-rules ABC-124 "Research" task.md   # without the shared rules
./close.sh workspace:N                  # close a worker, keeping its result on the overview
node overview.mjs --once                # print the overview once
./pm.sh                                 # restart the PM if it exited
```

## How it works

| File | What |
|---|---|
| `cmux.sh` | Builds the layout and writes `state/pm.json` (where the PM is) |
| `pm.sh`, `pm-prompt.md` | Starts the PM session with the skill |
| `spawn.sh`, `worker-rules.md` | Starts a worker in a new cmux workspace |
| `close.sh` | Closes a worker: records it as closed, then `cmux workspace close` |
| `watch.mjs`, `cmuxlib.mjs` | Every 10 s reads each worker's screen and relays new `STATUS:` lines to the PM |
| `overview.mjs`, `state.mjs` | The left pane, and the shared state |
| `usage.mjs` | Plan-limit bars and per-worker token counts |
| `config.mjs` | Reads `staffer.config.json` |
| `state/` | `sessions.json` (open), `closed.json` (closed, kept 7 days), `events.log`, prompts, `watch.log`. Local only, git-ignored |

### Your Claude sign-in and the usage bars

The usage bars reuse the Claude sign-in you already have in Claude Code. There's no separate login and no API key.

- `usage.mjs` reads Claude Code's OAuth token locally, from the macOS Keychain item `Claude Code-credentials` (or `~/.claude/.credentials.json` where there is no Keychain).
- The token goes in one place only: the `Authorization` header of a request to `api.anthropic.com/api/oauth/usage`, the same Anthropic endpoint Claude Code's own `/usage` calls. It is never sent to any other host, and staffer has no telemetry or server of its own.
- The token is only held in memory for that request. It is never logged, printed, or written to disk.
- Only the response (percentages and reset times, no credentials) is cached, in `state/usage.json`, and refreshed at most once a minute.
- macOS may ask once whether `security` can read the Keychain item. Say no, or sign out of Claude Code, and the bars show "usage unavailable"; everything else works.

This endpoint isn't a public API and may change. If it does, the bars show "usage unavailable" and the rest keeps working.

**Token counts** come from each worker's Claude Code transcript under `~/.claude/projects/`, matched by the session name `spawn.sh` gives it (`<ticket> <title>`).

## Uninstall

1. Close the PM workspace and any worker workspaces in cmux.
2. Delete the PM directory and the skill:

```bash
rm -rf <workdir>/.staffer            # or the --dir you chose
rm -rf ~/.claude/skills/<skill>      # e.g. ~/.claude/skills/acme-pm
```

Nothing else is installed: `npx` keeps only its download cache, and staffer doesn't touch your shell profile, Claude Code settings or credentials.

## Security

- This repo git-ignores `state/`, `staffer.config.json`, `.env*` and logs; the PM directory `init` creates git-ignores `state/`, `.env*` and logs.
- Every push and pull request runs [gitleaks](https://github.com/gitleaks/gitleaks) over the full git history ([workflow](.github/workflows/secrets.yml)).
- Found a problem? Open an issue, or for anything sensitive, a [private security advisory](https://github.com/sergionahas/staffer/security/advisories/new).

## License

MIT
