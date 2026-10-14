#!/usr/bin/env node
// Fork/rebrand renamer for the Virga website baseline (zero-dependency).
//
// Virga is a self-contained baseline: instantiate it, rebrand it, deploy it as
// a new site. This script rewrites every *instance identity* literal in the
// tree — repo slug, product domain, display name, CLI bin and its env-var
// prefix, Cloudflare worker resource names (so an instance is account-safe
// even when it shares an account with Virga), the workers.dev subdomain
// placeholder — to the values in a values file, and leaves *org-owned*
// identity alone (the GitHub org `sourceplane`, the orun state backend, the
// `sourceplane.io` manifest apiVersion, company mailboxes).
//
// Usage (from the repo root, on a clean tree):
//   node tooling/rebrand/rebrand.mjs --values my-brand.json [--dry-run]
//   node tooling/rebrand/rebrand.mjs --verify [--values my-brand.json]
//
// Values file (see tooling/rebrand/values.example.json):
//   {
//     "reponame":            "acme-blog",           // required — repo slug
//     "productname":         "Acme Blog",           // required — display name
//     "productdomain":       "acme.blog",           // required — product domain
//     "brandSlug":           "acme",                // default: reponame
//     "cliBin":              "acme",                // default: reponame
//     "subdomain": "my-subdomain",        // default: your-workers-subdomain
//     "orunWorkspace":       "ws_XXXXXXXX",         // remote-state workspace
//     "orunWorkspaceSlug":   "acme-space"           // optional: the segment secret refs use
//   }
//
// Modes:
//   (default)   apply the rename map in place, then run the leftover sweep
//   --dry-run   report per-pair match counts and files; change nothing
//   --verify    only run the leftover sweep (non-zero exit on residue)

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ── Inputs ─────────────────────────────────────────────────────

function flag(name) {
  return process.argv.includes(`--${name}`);
}
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dryRun = flag("dry-run");
const verifyOnly = flag("verify");

let values = {};
// --verify takes --values too, optionally: without them it cannot tell the
// product's own identity from a leftover of the baseline's (below).
const valuesPath = arg("values");
if (!verifyOnly && !valuesPath) {
  console.error("usage: rebrand.mjs --values <file> [--dry-run] | --verify [--values <file>]");
  process.exit(2);
}
if (valuesPath) {
  values = JSON.parse(fs.readFileSync(valuesPath, "utf8"));
  for (const required of ["reponame", "productname", "productdomain"]) {
    if (typeof values[required] !== "string" || values[required].length === 0) {
      console.error(`rebrand: values file is missing required field "${required}"`);
      process.exit(2);
    }
  }
}

// ── THE BASELINE'S OWN IDENTITY — the FROM side, declared ──────
//
// Every rule below renames the BASELINE's identity to the product's. The
// baseline's half of each pair used to be a hardcoded literal — `virga`,
// `Virga`, `VIRGA_`, `virga.site`, `mail.virga.site` — which meant only a
// repository literally named `virga` could serve as a baseline. Promoting a
// proven instantiation to be the next baseline (which is how a baseline line
// is meant to advance: Cirrus did exactly this to become cirrus-baseline)
// required editing every literal by hand and re-proving the rebrand, and
// getting one wrong is silent: the stray literal simply never renames, and the
// product ships with the baseline's name inside it.
//
// So the FROM side is declared in `.baseline/identity.json`, and the defaults
// below are Virga's — a tree that does not carry the file behaves exactly as
// it did before this change.
//
//   slug        the lowercase brand word: repo slug, CLI bin, worker prefix,
//               env-var prefix, secret project
//   pascal      the brand word as it appears in prose and config (`Virga`)
//   productName the display name (`name: "Virga"` in the site config)
//   domain      the product domain; the mail sender is `mail.<domain>`
//   subdomain   the workers.dev subdomain this tree carries — for Virga the
//               `your-workers-subdomain` placeholder, because the baseline
//               itself has never deployed
//
// RESOLVED AGAINST THIS SCRIPT, NOT THE WORKING DIRECTORY. The rebrand runs
// with its cwd set to the PRODUCT being branded, while the identity it renames
// FROM belongs to the BASELINE — and a product does not carry `.baseline/`,
// because no module places it. The phase hooks invoke this as
// `node {{ .baseline.dir }}/tooling/rebrand/rebrand.mjs`, so the script's own
// path is the one thing that always points at the baseline.
// `--baseline-identity <file>` overrides it (the test suites pin one).
const BASELINE_IDENTITY_FILE =
  arg("baseline-identity") ??
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".baseline", "identity.json");
const BASELINE_DEFAULTS = {
  slug: "virga",
  pascal: "Virga",
  productName: "Virga",
  domain: "virga.site",
  subdomain: "your-workers-subdomain",
};
const baseline = (() => {
  let declared = {};
  try {
    declared = JSON.parse(fs.readFileSync(BASELINE_IDENTITY_FILE, "utf8"));
  } catch {
    declared = {}; // absent is fine: the defaults ARE Virga's identity
  }
  const id = { ...BASELINE_DEFAULTS };
  for (const k of Object.keys(BASELINE_DEFAULTS)) {
    if (declared[k] !== undefined) id[k] = declared[k];
  }
  for (const [k, v] of Object.entries(id)) {
    if (typeof v !== "string" || v.length === 0) {
      console.error(`rebrand: ${BASELINE_IDENTITY_FILE} field "${k}" must be a non-empty string`);
      process.exit(2);
    }
  }
  if (/[^a-z0-9-]/.test(id.slug)) {
    console.error(`rebrand: ${BASELINE_IDENTITY_FILE} "slug" must be a lowercase slug ([a-z0-9-])`);
    process.exit(2);
  }
  return {
    ...id,
    envPrefix: id.slug.toUpperCase().replace(/-/g, "_"),
    mailDomain: `mail.${id.domain}`,
  };
})();
// Regex-escape, for the rules that build a pattern out of the identity.
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// All fields are unused under --verify; the fallbacks keep derivation total.
const repoName = values.reponame ?? "";
const productName = values.productname ?? "";
const productDomain = values.productdomain ?? "";
const brandSlug = values.brandSlug ?? repoName;
const cliBin = values.cliBin ?? repoName;
const workersDevSubdomain = values.subdomain ?? "your-workers-subdomain";
// A `secret://<workspace>/<project>/<env>/<KEY>` ref names the WORKSPACE first
// and the project (repo) second. In this baseline both happen to be `virga` —
// the workspace's slug and the repo's — so the scoped rule below must run
// before the repo-slug pass, or one rename would rewrite both. A product lives
// in its own workspace, so the segment is renamed: orunWorkspaceSlug when the
// caller supplied one, else orunWorkspace itself.
//
// A ws_… id IS a valid workspace segment. The resolve verifies the segment
// against membership and accepts a slug, a public id or a ws_ ref (orun-cloud
// state-worker secrets-resolve.ts, verifySegments). This used to skip a ws_…
// id and KEEP the baseline's segment — and the blueprint's `orunWorkspace`
// input is always a ws_… id (`from: workspace`) and nothing supplies a slug,
// so every product built from this baseline carried the baseline's workspace
// and every resolve in it was refused:
//
//   Ref workspace "lumen" does not name this run's workspace
//
// The repo name is the last resort, only when no workspace was given at all.
const orunWorkspaceSlug = (() => {
  const explicit = (values.orunWorkspaceSlug ?? "").trim();
  if (explicit) return explicit;
  const ws = (values.orunWorkspace ?? "").trim();
  if (ws) return ws;
  return repoName;
})();
const envPrefix = cliBin.toUpperCase().replace(/-/g, "_");

if (!verifyOnly && /[^a-z0-9-]/.test(`${repoName}${brandSlug}${cliBin}`)) {
  console.error("rebrand: reponame/brandSlug/cliBin must be lowercase slugs ([a-z0-9-])");
  process.exit(2);
}

// In-place rewrite of the whole tree: insist on a clean checkout so the result
// is reviewable as one diff (and trivially revertible).
if (!verifyOnly && !dryRun && !flag("allow-dirty")) {
  const status = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" });
  if (status.trim().length > 0) {
    console.error("rebrand: working tree is not clean — commit/stash first (or pass --allow-dirty)");
    process.exit(2);
  }
}

// ── File set ───────────────────────────────────────────────────

// Tracked text files only. Exclusions are generated/locked artifacts, this
// tool itself, or files that intentionally keep baseline-provenance literals.
const EXCLUDE_RE = new RegExp(
  [
    "^tooling/rebrand/",
    "^\\.rebrand/",
    // The baseline's declared identity. Renaming its contents would make the
    // product claim to be a baseline called by the product's own name.
    "^\\.baseline/",
    "^ai/context/provenance\\.md$",
    "^pnpm-lock\\.yaml$",
    "^kiox\\.lock$",
    "\\.(png|jpg|jpeg|ico|gif|woff2?|ttf|eot)$",
  ].join("|"),
);

function trackedFiles() {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter((f) => f.length > 0 && !EXCLUDE_RE.test(f))
    .filter((f) => {
      // `git ls-files` also lists gitlinks (a grounded sandbox checkout carries
      // `baseline/` as one) and paths deleted from disk. Only regular files are
      // sweepable; a gitlink crashes readFileSync mid-bootstrap.
      try {
        return fs.statSync(f).isFile();
      } catch {
        return false;
      }
    });
}

// ── Protected literals (org-owned identity, never rewritten) ───

const PROTECTED = [
  /https:\/\/api-edge-prod\.oruncloud\.workers\.dev/g, // orun state backend
  /sourceplane\.io/g, // manifest apiVersion, owned by the orun tooling
  /[A-Za-z0-9._%+-]+@sourceplane\.ai/g, // company mailboxes
  /github\.com\/sourceplane/g, // provenance links
];

const MASK = (i, j) => `\u0000REBRAND_PROTECTED_${i}_${j}\u0000`;

// ── Substituted values are opaque ──────────────────────────────
//
// The rules run in sequence over one buffer, and each used to write its VALUE
// into it — where every later rule could match again. A value that contains a
// baseline word was rewritten a second time:
//
//   secret://virga/virga/…  →  secret://ws_X/virga-e2e/…   (secret ref)
//                           →  secret://ws_X/virga-e2e-e2e/…  (repo slug)
//
// and a bootstrap re-runs this over the whole tree in every phase, so even a
// value written correctly once was mangled by the next phase's pass. So a rule
// writes a TOKEN standing for its value, and every token is expanded once,
// after the last rule. A token is NUL, `H<n>`, NUL — NUL cannot occur in a
// file this touches (binary files are skipped; the protected-literal mask
// above relies on the same fact), and nothing between the NULs is anything a
// rule matches. Its outer characters take the word/non-word class of the
// value's own first and last characters, so a `\b` in a later rule sees the
// same boundary beside the token that it would have seen beside the value.
// Ported from Cirrus, where it was found live.
const heldValues = [];
const heldIndex = new Map();
function hold(value) {
  if (value === "") return "";
  let i = heldIndex.get(value);
  if (i === undefined) {
    i = heldValues.push(value) - 1;
    heldIndex.set(value, i);
  }
  const edge = (c) => (/\w/.test(c) ? "0" : "\u0001");
  return `${edge(value[0])}\u0000H${i}\u0000${edge(value[value.length - 1])}`;
}
const HELD_RE = /[0\u0001]\u0000H(\d+)\u0000[0\u0001]/g;
function release(text) {
  return text.replace(HELD_RE, (_, i) => heldValues[Number(i)]);
}

// ── Worker resource names ──────────────────────────────────────
//
// Every Worker ships brand-prefixed as `<slug>-<base>` (top-level wrangler
// "name", `<worker>-<env>` service bindings, smoke health-checks, the site's
// CORS origins). The base of each is its `apps/<base>/` directory. Re-prefix
// `<slug>-<base>` → `<brandSlug>-<base>` so an instance's Workers never collide
// with the baseline's, even in a shared Cloudflare account.
function workerBases(files) {
  const bases = new Set();
  for (const file of files) {
    const m = /^apps\/([^/]+)\//.exec(file);
    if (m) bases.add(m[1]);
  }
  return [...bases];
}

// ── Rename map (ordered, most specific first) ──────────────────

function pairs() {
  return [
    // Mail sender on the product's own subdomain.
    [baseline.mailDomain, `mail.${productDomain}`, "mail sending domain"],
    // Product domain wherever it is the *product* (BASE_DOMAIN, custom
    // domains, site.config url, docs). The backend URL is masked above.
    [baseline.domain, productDomain, "product domain"],
    // The site's display name in its config (the smoke marker).
    [`name: "${baseline.productName}"`, `name: "${productName}"`, "site display name"],
    // CLI config/env references in docs and command examples.
    [`\`${baseline.slug} `, `\`${cliBin} `, "CLI bin (doc examples, open)"],
    [`\`${baseline.slug}\``, `\`${cliBin}\``, "CLI bin (doc examples, closed)"],
  ];
}

// ── The brand word (display name vs. code identifier) ──────────
//
// Virga has no exported brand-named class, so every `Virga` is prose or copy:
// it becomes the display name everywhere.

function replaceBrandWord(file, text, count) {
  const BRAND_WORD = new RegExp(rx(baseline.pascal), "g");
  return text.replace(BRAND_WORD, () => {
    count();
    return hold(productName);
  });
}

// Scoped, regex-based pairs applied after the literal map.
function scopedPairs(files) {
  const list = [
    // Secret refs: `secret://<workspace>/<project>/…`. MUST precede the
    // repo-slug pass, which would otherwise rewrite the workspace segment.
    // The workspace segment is ANY segment, not just a lowercase slug: a
    // baseline promoted from a live product carries that product's ws_… id
    // there (cirrus-baseline: `secret://ws_KWQ45Z6M/cirrus-baseline/…`), and
    // `[a-z0-9-]+` never matched it, so only the project half was renamed.
    {
      re: new RegExp(`\\bsecret://[A-Za-z0-9_-]+/${rx(baseline.slug)}/`, "g"),
      replacement: () => `secret://${orunWorkspaceSlug}/${repoName}/`,
      label: "secret ref workspace/project",
    },
    // Branded env-var names: VIRGA_API_URL / VIRGA_OWNER_TOKEN and the doc
    // placeholders that name them.
    {
      re: new RegExp(`${rx(baseline.envPrefix)}_(?=[A-Z])`, "g"),
      replacement: () => `${envPrefix}_`,
      label: "branded env-var prefix",
    },
    // CLI bin: usage strings, the package bin, doc commands. Inside
    // packages/cli the token only ever means the binary — and inside
    // tests/cli it means the same thing, because that suite asserts on the
    // CLI's own output. Routing the suite through the repo-slug pass instead
    // made every instance whose cliBin differs from its repoName fail its own
    // CLI tests (the source printed `acme`, the test expected `acme-blog`).
    {
      re: new RegExp(`\\b${rx(baseline.slug)}\\b`, "g"),
      replacement: () => cliBin,
      label: "CLI bin (packages/cli, tests/cli)",
      fileFilter: (file) => file.startsWith("packages/cli/") || file.startsWith("tests/cli/"),
    },
  ];

  // Re-prefix every Cloudflare Worker resource name (`<slug>-<base>`). The
  // alternation is the explicit set of worker bases, so `<slug>-stage` /
  // `<slug>-prod` (the D1 database names, repo-slug-derived) never match here —
  // they fall to the repo-slug pass below.
  const bases = workerBases(files);
  if (bases.length > 0) {
    // Longest-first so an alternation never matches a shorter prefix of a base.
    const wb = bases.slice().sort((a, b) => b.length - a.length).join("|");
    list.push({
      re: new RegExp(`\\b${rx(baseline.slug)}-(${wb})\\b`, "g"),
      replacement: (_file, _m, base) => `${brandSlug}-${base}`,
      label: "worker CF name",
    });
  }

  // The workers.dev subdomain in wrangler templates and the web-site
  // component. Only rewritten when the caller supplied a different one.
  if (workersDevSubdomain !== baseline.subdomain) {
    list.push({
      re: new RegExp(`\\b${rx(baseline.subdomain)}\\b`, "g"),
      replacement: () => workersDevSubdomain,
      label: "workers.dev subdomain",
    });
  }

  // Repo slug: intent metadata.name, per-env repo: params, component.yaml
  // repo: fields, Terraform repo defaults, D1 database names
  // (`<slug>-stage` → `<repo>-stage`), root package name, docs. Runs AFTER the
  // worker pass so `<slug>-<worker>` has already been consumed. The CLI package
  // and its suite own the CLI-bin meaning (handled above), so both are
  // excluded here.
  list.push({
    re: new RegExp(`\\b${rx(baseline.slug)}\\b`, "g"),
    replacement: () => repoName,
    label: "repo slug",
    fileFilter: (file) => !file.startsWith("packages/cli/") && !file.startsWith("tests/cli/"),
  });

  return list;
}

// ── Leftover sweep ─────────────────────────────────────────────
//
// After a rebrand (or under --verify) every remaining baseline-identity literal
// is residue: either org-owned (allowed, enumerated below) or a missed rename
// (reported, non-zero exit).

// The baseline's workers.dev subdomain is residue ONLY when the product changed
// it: an instance that keeps the placeholder (or, for a promoted baseline, the
// same Cloudflare account) is not a missed rename. Under --verify with no
// values the check is skipped for the same reason.
const subdomainChanged = !verifyOnly && workersDevSubdomain !== baseline.subdomain;
const RESIDUE_RE = new RegExp(
  (subdomainChanged ? `\\b${rx(baseline.subdomain)}\\b|` : "") +
    [
      `\\b${rx(baseline.slug)}\\b`,
      `${rx(baseline.slug)}-`,
      rx(baseline.pascal),
      `${rx(baseline.envPrefix)}_`,
    ].join("|"),
  "g",
);

const ALLOWED_RESIDUE = [
  /https:\/\/api-edge-prod\.oruncloud\.workers\.dev/,
  /[A-Za-z0-9._%+-]+@sourceplane\.ai/,
  /github\.com\/sourceplane\/[a-z-]+/,
];

function sweep(files, allowedLiterals = []) {
  const residue = [];
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      // Strip allowed (org-owned) forms first; whatever still matches is residue.
      let cleaned = ALLOWED_RESIDUE.reduce((l, re) => l.replace(new RegExp(re.source, "g"), ""), line);
      // Then the rename's own TARGET values: an instance legitimately named
      // with the brand token inside it (repo "virga-e2e") is not residue.
      for (const lit of allowedLiterals) {
        if (lit) cleaned = cleaned.split(lit).join("");
      }
      if (new RegExp(RESIDUE_RE.source).test(cleaned)) {
        residue.push(`${file}: ${line.trim().slice(0, 120)}`);
      }
    }
  }
  return residue;
}

// ── Main ───────────────────────────────────────────────────────

const files = trackedFiles();

const literalPairs = pairs();
const regexPairs = scopedPairs(files);
const counts = new Map();
const touched = new Set();

// Every value a rule can write. A value that some rule would match again is
// HELD wherever it already stands in a file: every phase of a bootstrap re-runs
// this over the whole tree, so the product a previous run branded is the input
// to the next one, and what phase 01 wrote must survive phase 02's pass.
const produced = [
  ...literalPairs.map(([, to]) => to),
  productName,
  `secret://${orunWorkspaceSlug}/${repoName}/`,
  `${envPrefix}_`,
  cliBin,
  repoName,
  ...workerBases(files).map((base) => `${brandSlug}-${base}`),
].filter((v, i, all) => v && all.indexOf(v) === i);
const rematchable = (v) =>
  literalPairs.some(([from]) => v.includes(from)) ||
  new RegExp(rx(baseline.pascal)).test(v) ||
  regexPairs.some(({ re }) => new RegExp(re.source).test(v));
// Longest first, so a held value is never split by a shorter one inside it.
const guarded = produced.filter(rematchable).sort((a, b) => b.length - a.length);

if (verifyOnly) {
  // A product whose own name, domain or workspace slug contains a baseline
  // word (`virga-e2e`) carries that word legitimately, and without its values
  // --verify cannot know that. Given --values, what this rebrand would write
  // is allowed exactly as the post-rename sweep allows it.
  const residue = sweep(
    files,
    valuesPath ? produced.filter((to) => new RegExp(RESIDUE_RE.source).test(to)) : [],
  );
  if (residue.length > 0) {
    console.error(`rebrand --verify: ${residue.length} baseline-identity leftover(s):`);
    for (const r of residue) console.error(`  ${r}`);
    process.exit(1);
  }
  console.log("rebrand --verify: no baseline-identity leftovers.");
  process.exit(0);
}

for (const file of files) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (text.includes("\0")) continue; // binary safety net
  const original = text;

  // Mask org-owned literals.
  const masks = [];
  PROTECTED.forEach((re, i) => {
    text = text.replace(re, (m) => {
      const token = MASK(i, masks.length);
      masks.push([token, m]);
      return token;
    });
  });

  // What a previous run already wrote stays as written.
  for (const value of guarded) text = text.split(value).join(hold(value));

  for (const [from, to, label] of literalPairs) {
    const n = text.split(from).length - 1;
    if (n === 0) continue;
    text = text.split(from).join(hold(to));
    counts.set(label, (counts.get(label) ?? 0) + n);
  }

  text = replaceBrandWord(file, text, () =>
    counts.set("display name", (counts.get("display name") ?? 0) + 1),
  );

  for (const { re, replacement, label, fileFilter } of regexPairs) {
    if (fileFilter && !fileFilter(file)) continue;
    text = text.replace(re, (...m) => {
      counts.set(label, (counts.get(label) ?? 0) + 1);
      return hold(replacement(file, ...m));
    });
  }

  // Every rule has run; only now do the values it wrote appear.
  text = release(text);

  // Restore org-owned literals.
  for (const [token, literal] of masks) text = text.split(token).join(literal);

  if (text !== original) {
    touched.add(file);
    if (!dryRun) fs.writeFileSync(file, text);
  }
}

const total = [...counts.values()].reduce((a, b) => a + b, 0);
for (const [label, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(n).padStart(5)}  ${label}`);
}
console.log(`\n${total} replacement(s) across ${touched.size} file(s)${dryRun ? " (dry run — nothing written)" : ""}`);

if (!dryRun) {
  const residue = sweep(
    trackedFiles(),
    produced.filter((to) => new RegExp(RESIDUE_RE.source).test(to)),
  );
  if (residue.length > 0) {
    console.error(`\nrebrand: ${residue.length} baseline-identity leftover(s):`);
    for (const r of residue) console.error(`  ${r}`);
    process.exit(1);
  }
  console.log("rebrand: no baseline-identity leftovers.");
}
