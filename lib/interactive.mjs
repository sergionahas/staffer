// Interactive `staffer init`: pick a project with the arrow keys, confirm what was detected.
// Flags still win: any answer given as a flag is not asked.
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import * as p from "@clack/prompts";
import { discover, guessPrefix, projectAt } from "./discover.mjs";

const TRACKERS = [
  { value: "Linear (the linear MCP server)", label: "Linear" },
  { value: "GitHub Issues", label: "GitHub Issues" },
  { value: "Jira", label: "Jira" },
  { value: "", label: "None" },
  { value: "__other", label: "Other…" },
];

const tilde = (s) => (s.startsWith(homedir()) ? "~" + s.slice(homedir().length) : s);
const ago = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 60 ? `${m}m ago` : m < 2880 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

// Exit cleanly on Ctrl-C / Esc at any prompt.
const ok = (v) => {
  if (p.isCancel(v)) { p.cancel("Cancelled. Nothing was written."); process.exit(1); }
  return v;
};

function ghOwner() {
  const r = spawnSync("gh", ["api", "user", "--jq", ".name // .login"], { encoding: "utf8", timeout: 4000 });
  return r.status === 0 ? r.stdout.trim().split(" ")[0] : "";
}

export async function ask(args, { readConfig, foreignSkill, skillsDir, slug, expand }) {
  p.intro(" staffer init ");

  // 1. Project (= workdir)
  let workdir = args.workdir && resolve(expand(args.workdir));
  if (!workdir) {
    const projects = discover({ roots: args.roots });
    const OTHER = "__other";
    const choice = ok(await p.autocomplete({
      message: "Which project?",
      placeholder: "type to filter",
      maxItems: 12,
      filter: (q, o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q.toLowerCase()),
      options: [
        ...projects.map((x) => ({
          value: x.path,
          label: x.staffer ? `${x.name}  ✓ staffer` : x.name,
          hint: `${tilde(x.path)} · ${x.repos.length === 1 ? (x.slugs[0] ?? "1 repo") : `${x.repos.length} repos`} · ${ago(x.touched)}`,
        })),
        { value: OTHER, label: "+ Other folder…" },
      ],
    }));
    workdir = choice !== OTHER ? choice : resolve(expand(ok(await p.path({
      message: "Folder (where sessions start)", directory: true, initialValue: process.cwd(),
    }))));
  }

  const dir = resolve(expand(args.dir ?? join(workdir, ".staffer")));
  const prev = readConfig(dir);
  const found = projectAt(workdir);
  const isSetUp = Object.keys(prev).length > 0;

  // Already set up: keep the config, only offer the upgrade (flags can still change single fields).
  if (isSetUp) {
    p.note([
      `project  ${prev.project}`,
      `repos    ${(prev.repos ?? []).join(", ") || "none"}`,
      `tickets  ${prev.ticketPrefix || "-"} in ${prev.tracker || "-"}`,
      `skill    ${prev.skill}`,
    ].join("\n"), `Already set up in ${tilde(dir)}`);
    ok(await p.confirm({ message: "Upgrade the tooling and re-render the skill?" })) || (p.cancel("Nothing changed."), process.exit(0));
  }

  const keep = (flag, key) => args[flag] ?? (isSetUp && key in prev ? prev[key] : undefined);

  // 2. Name
  const project = keep("project", "project") ?? ok(await p.text({
    message: "Project name", initialValue: basename(workdir), validate: (v) => (v?.trim() ? undefined : "Required"),
  })).trim();

  // 3. Repos to watch
  let repos = args.repos ? args.repos.split(",").map((s) => s.trim()).filter(Boolean) : isSetUp ? prev.repos ?? [] : null;
  if (!repos) {
    const slugs = found?.slugs ?? [];
    if (slugs.length > 1) {
      repos = ok(await p.multiselect({ message: "Repos to watch for PRs", options: slugs.map((s) => ({ value: s, label: s })), initialValues: slugs, required: false }));
    } else if (slugs.length === 1) {
      repos = slugs;
    } else {
      const t = ok(await p.text({ message: "GitHub repos to watch for PRs (owner/repo, comma-separated)", placeholder: "optional" }));
      repos = (t ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    }
  }

  // 4. Tracker and ticket prefix
  let tracker = keep("tracker", "tracker");
  if (tracker === undefined) {
    tracker = ok(await p.select({ message: "Where do tickets live?", options: TRACKERS, initialValue: TRACKERS[0].value }));
    if (tracker === "__other") tracker = ok(await p.text({ message: "Where do tickets live? (in words)" })) ?? "";
  }
  const ticketPrefix = (keep("prefix", "ticketPrefix") ?? (tracker ? ok(await p.text({
    message: "Ticket prefix (ABC for ABC-123)",
    initialValue: (found && guessPrefix(found)) || "",
    placeholder: "optional",
  })) ?? "" : "")).trim().toUpperCase();

  // 5. Owner: what the PM calls you (from your GitHub name if there is one)
  const owner = keep("owner", "owner") ?? (ok(await p.text({ message: "What should the PM call you?", initialValue: ghOwner() || "", placeholder: "the user" })) || "the user");

  // 6. Skill name: default <project>-pm, unless a skill by that name exists that staffer didn't make
  let skill = keep("skill", "skill");
  if (!skill) {
    skill = `${slug(project)}-pm`;
    if (foreignSkill(skillsDir, skill)) {
      skill = slug(ok(await p.text({
        message: `A skill named ${skill} already exists (not made by staffer). Name for the new one?`,
        initialValue: `${slug(project)}-staffer-pm`,
        validate: (v) => (!v?.trim() ? "Required" : foreignSkill(skillsDir, slug(v)) ? "That one exists too" : undefined),
      })));
    }
  }

  // 7. Layout
  let layout = args["no-layout"] ? "none" : args.new ? "new" : null;
  if (!layout) {
    layout = process.env.CMUX_WORKSPACE_ID ? ok(await p.select({
      message: "Open the PM in cmux",
      options: [
        { value: "new", label: "New workspace", hint: "recommended" },
        { value: "here", label: "This workspace", hint: "replaces its panes" },
        { value: "none", label: "Not now" },
      ],
    })) : "new"; // not in cmux: init prints how to open it later

  }

  p.outro(`Setting up ${project} in ${tilde(dir)}`);
  return { workdir, dir, prev, project, repos, ticketPrefix, tracker, owner, skill, layout };
}
