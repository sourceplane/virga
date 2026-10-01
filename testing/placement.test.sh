#!/usr/bin/env bash
# THE BUILD DOCUMENT RUNS, AND WHAT IT PLACES IS A PRODUCT.
#
# Every other gate here reads `repo-blueprint.yaml` with PyYAML, which will
# parse anything well-formed. None of them asked the question that matters:
# can the orun CLI read it. It could not. As first pushed to this repository,
#
#     ✕ phases[0] (01-scaffold) hooks[9] (land): action orun.pr/land@v1 has no
#       parameter "repo"
#     ✕ input "domain" has unknown type "bool"
#
# — refused by every released orun at the first phase, with six gates green.
# A bootstrap would have failed before placing a file.
#
# So this makes orun itself answer, and then looks at what it placed:
#   1. `orun new` places the whole blueprint, hooks off. That parses the
#      document, validates every hook against the action registry, and runs
#      the repo-scale gate (`orun validate` + `orun plan --dry-run`) on the
#      placed tree.
#   2. The tree is branded exactly as 01-scaffold's hooks brand it, and
#      `rebrand --verify` finds no baseline identity left.
#   3. The product carries no factory path, its `intent.yaml` claims the
#      product's workspace, and every secret ref names that workspace.
#
# Offline: placement writes files and a run with hooks off does not probe.
# Needs: orun (>= the floor BOOTSTRAP.md names), node, python3, git.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"

command -v orun >/dev/null || { echo "placement.test.sh needs orun on PATH" >&2; exit 1; }
command -v node >/dev/null || { echo "placement.test.sh needs node for rebrand" >&2; exit 1; }

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
fails=0
fail() { echo "  ✕ $*" >&2; fails=$((fails + 1)); }

# Awkward on purpose: a two-word name, a hyphenated slug, a workspace given as
# the ws_… id the blueprint's `from: workspace` always supplies. `domain` is on
# because 07-domain is conditional and a gate that skips a phase cannot vouch
# for it.
WS="ws_0000000F"
sets=(
  --set repoName=acme-blog
  --set "productName=Acme Blog"
  --set productDomain=acme.blog
  --set githubOrg=acme-co
  --set workersDevSubdomain=acme
  --set "orunWorkspace=$WS"
  --set domain=true
)

tree="$scratch/product"
mkdir -p "$tree"/{apps,infra,packages,tests}

echo "── placing the whole blueprint (offline, no credential)"
if ! orun new --blueprint "$root/repo-blueprint.yaml" --out "$tree" "${sets[@]}" \
     > "$scratch/place.log" 2>&1; then
  echo "FAIL: orun refused the build document, or the placement did not run ($(orun version 2>&1 | head -1))" >&2
  tail -20 "$scratch/place.log" >&2
  exit 1
fi
grep -q "repo gate: validate + plan --dry-run passed" "$scratch/place.log" \
  || fail "the placement did not report the repo-scale gate (orun validate + plan --dry-run)"
placed_count="$(find "$tree" -type f -not -path "*/.orun/*" | wc -l | tr -d ' ')"
[ "$placed_count" -ge 200 ] || fail "only $placed_count files placed — that is not a product"
echo "   $placed_count files placed; the repo-scale gate ran"

echo "── branding, as 01-scaffold's hooks do, then rebrand --verify"
(
  cd "$tree"
  git init -q -b main
  git config user.email t@example.invalid
  git config user.name "tier one"
  printf '.orun/\n' >> .gitignore
  git add -A
) >/dev/null 2>&1
if ! (cd "$tree" && node "$root/tooling/rebrand/rebrand.mjs" \
      --values .rebrand/values.json --allow-dirty) > "$scratch/brand.log" 2>&1; then
  echo "FAIL: rebrand did not complete" >&2; tail -20 "$scratch/brand.log" >&2; exit 1
fi
# The blueprint's own `orun-workspace` hook, extracted and run rather than
# re-typed here, so this exercises the document's code and not a copy of it.
python3 - "$root/repo-blueprint.yaml" "$scratch/ws-hook.js" <<'PY'
import sys, yaml
bp = yaml.safe_load(open(sys.argv[1]))
ph = next(p for p in bp["phases"] if p["name"] == "01-scaffold")
hooks = [h for hs in ph["hooks"].values() for h in hs]
hook = next((h for h in hooks if h.get("id") == "orun-workspace"), None)
if not hook or hook["run"][:2] != ["node", "-e"]:
    sys.exit("01-scaffold has no `orun-workspace` node hook — this check has gone blind")
open(sys.argv[2], "w").write(hook["run"][2])
PY
(cd "$tree" && node "$scratch/ws-hook.js") > "$scratch/ws.log" 2>&1 \
  || { echo "FAIL: the orun-workspace hook failed" >&2; cat "$scratch/ws.log" >&2; exit 1; }
(cd "$tree" && git add -A) >/dev/null 2>&1
if ! (cd "$tree" && node "$root/tooling/rebrand/rebrand.mjs" \
      --verify --values .rebrand/values.json) > "$scratch/verify.log" 2>&1; then
  echo "FAIL: rebrand --verify found baseline identity left in the product" >&2
  tail -20 "$scratch/verify.log" >&2; exit 1
fi
echo "   branded; no baseline-identity residue"

echo "── what the product actually carries"
python3 - "$tree" "$WS" <<'PY'
import pathlib, re, sys
tree, ws = pathlib.Path(sys.argv[1]), sys.argv[2]
problems = []
def bad(m): problems.append(m)

placed = sorted(
    p.relative_to(tree).as_posix()
    for p in tree.rglob("*")
    if p.is_file() and ".git" not in p.parts and ".orun" not in p.parts
)

NEVER = ("flows/", "agents/", "tasks/", "specs/", "testing/", "hooks/",
         "docs/phases/", "tooling/rebrand/", "tooling/bootstrap/",
         "tooling/blueprint/", "tooling/migrations/",
         "BOOTSTRAP.md", "repo-blueprint.yaml", "blueprint.yaml",
         ".github/workflows/baseline.yml", ".github/workflows/tag.yml",
         ".github/workflows/rehearsal.yml")
for p in placed:
    for never in NEVER:
        if p == never or p.startswith(never):
            bad(f"{p} shipped — it is the factory, not the product")

intent = (tree / "intent.yaml").read_text()
m = re.search(r"(?m)^\s*workspace:\s*(\S+)", intent)
if not m or m.group(1) != ws:
    bad(f"intent.yaml claims workspace {m.group(1) if m else None!r}; the build ran in {ws!r}")

refs = set()
for p in placed:
    if p.endswith("component.yaml"):
        refs |= set(re.findall(r"secret://[^/\"\s]+/[^/\"\s]+/", (tree / p).read_text()))
want = f"secret://{ws}/acme-blog/"
if not refs:
    bad("no secret ref in any placed component.yaml — this check has gone blind")
for r in sorted(refs - {want}):
    bad(f"a secret ref names {r} — the platform refuses a ref whose workspace is "
        f"not the run's; every ref must be {want}")

comps = [p for p in placed if p.endswith("/component.yaml")]
if problems:
    print("FAIL: the placed product is not the product:", file=sys.stderr)
    for p in problems:
        print(f"  - {p}", file=sys.stderr)
    sys.exit(1)
print(f"   {len(placed)} product files, {len(comps)} components; no factory path")
print(f"   intent.yaml and every secret ref name {ws}")
PY

[ "$fails" -eq 0 ] || exit 1
echo "placement.test.sh: ok"
