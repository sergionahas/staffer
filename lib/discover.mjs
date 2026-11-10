// Finds candidate projects for `staffer init`: folders that are a git repo, or hold git repos one level down.
// Reads .git directly (no git subprocesses) so scanning ~ stays fast.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const SKIP = new Set(["Library", "Applications", "Movies", "Music", "Pictures", "Public", "node_modules"]);

const subdirs = (p) => {
  try {
    return readdirSync(p, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP.has(e.name))
      .map((e) => join(p, e.name));
  } catch { return []; }
};
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
const mtime = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };

// "owner/repo" for a GitHub remote, or null.
export function githubSlug(url) {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url ?? "");
  return m ? `${m[1]}/${m[2]}` : null;
}

// Only plain clones (.git is a directory); worktrees and submodules are left out.
const isRepo = (p) => { try { return statSync(join(p, ".git")).isDirectory(); } catch { return false; } };

function repoInfo(path) {
  const git = join(path, ".git");
  const origin = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(read(join(git, "config")))?.[1];
  const loose = (dir, pre = "") => subdirs(dir).flatMap((d) => loose(d, `${pre}${basename(d)}/`))
    .concat((() => { try { return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => pre + e.name); } catch { return []; } })());
  const packed = [...read(join(git, "packed-refs")).matchAll(/refs\/heads\/(\S+)/g)].map((m) => m[1]);
  return {
    path,
    slug: githubSlug(origin),
    branches: [...new Set([...loose(join(git, "refs", "heads")), ...packed])],
    touched: Math.max(mtime(join(git, "index")), mtime(join(git, "HEAD")), mtime(join(git, "FETCH_HEAD"))),
  };
}

// A project = a folder that is a repo itself, or has repos as direct children.
export function projectAt(path) {
  const repos = (isRepo(path) ? [path] : subdirs(path).filter(isRepo)).map(repoInfo);
  if (!repos.length) return null;
  const staffer = ["staffer.config.json", "pm.config.json"].some((f) => existsSync(join(path, ".staffer", f)));
  return {
    name: basename(path),
    path,
    repos,
    slugs: [...new Set(repos.map((r) => r.slug).filter(Boolean))],
    staffer,
    touched: Math.max(...repos.map((r) => r.touched)),
  };
}

// Roots: --roots / STAFFER_ROOTS (comma-separated), default ~. Each root's children are candidates,
// and so is the current directory. Set-up projects first, then most recently touched.
export function discover({ roots, cwd = process.cwd() } = {}) {
  const list = (roots ?? process.env.STAFFER_ROOTS ?? "~").split(",").map((s) => s.trim()).filter(Boolean)
    .map((r) => (r === "~" ? homedir() : r.startsWith("~/") ? join(homedir(), r.slice(2)) : r));
  const seen = new Map();
  for (const p of [cwd, ...list.flatMap(subdirs)]) {
    if (seen.has(p) || list.includes(p)) continue;
    const proj = projectAt(p);
    if (proj) seen.set(p, proj);
  }
  return [...seen.values()].sort((a, b) => (b.staffer - a.staffer) || (b.touched - a.touched));
}

// Most common ticket prefix in branch names like "gol-123-x" or "sergio/gol-123-x"; "" if none.
export function guessPrefix(project) {
  const counts = {};
  for (const b of project.repos.flatMap((r) => r.branches)) {
    const m = /(?:^|\/)([a-z]{2,6})-\d+(?:\b|-)/i.exec(b);
    if (m && !/^(fix|feat|test|wip|hotfix|chore|issue|pr|v|rc)$/i.test(m[1])) { const k = m[1].toUpperCase(); counts[k] = (counts[k] ?? 0) + 1; }
  }
  const [best] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return best && best[1] >= 2 ? best[0] : "";
}
