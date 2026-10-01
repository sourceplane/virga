#!/usr/bin/env bash
# A PRODUCT'S SECRET REFS NAME THE PRODUCT'S WORKSPACE.
#
# Every deployable component reads its credentials through
# `secret://<workspace>/<project>/<env>/<KEY>`, and the platform refuses a ref
# whose workspace segment is not the workspace the run is in:
#
#     Ref workspace "lumen" does not name this run's workspace
#
# This baseline's own refs name ITS workspace (`virga`). rebrand.mjs rewrites
# the segment — and for as long as it skipped a `ws_…` id, which is the only
# form the blueprint's `orunWorkspace` input ever takes, it left the baseline's
# segment (then `lumen`) standing in every product.
# Nothing offline noticed: the leftover sweep looks for THIS repository's name,
# and a workspace slug is not it. The first thing to notice would have been phase 03's
# convergence, forty minutes into somebody's bootstrap.
#
# So this rebrands a copy of the tree three ways and reads the refs back.
# Needs: node, git. No network.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"

command -v node >/dev/null || { echo "tenancy.test.sh needs node" >&2; exit 1; }

fail=0
ok()  { echo "   ok  $*"; }
bad() { echo "   ✕  $*" >&2; fail=1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# One rebranded copy per case: the tracked tree, in a repository of its own,
# because rebrand.mjs sweeps `git ls-files`.
rebranded_refs() { # <case> <values-json>  -> prints the distinct ref prefixes
  local dir="$tmp/$1"
  mkdir -p "$dir"
  (cd "$root" && git ls-files -z | tar --null -T - -cf -) | tar -C "$dir" -xf -
  (
    cd "$dir"
    git init -q && git add -A
    mkdir -p .rebrand && printf '%s\n' "$2" > .rebrand/values.json
    node tooling/rebrand/rebrand.mjs --values .rebrand/values.json --allow-dirty > rebrand.log 2>&1 \
      || { cat rebrand.log >&2; exit 1; }
    git grep -h -o -E 'secret://[^/"]+/[^/"]+/' -- . ':!tooling/rebrand' ':!testing' ':!rebrand.log' | sort -u
  )
}

base='"repoName":"acme-blog","productName":"Acme Blog","productDomain":"acme.blog","workersDevSubdomain":"acme","githubOrg":"acme-co"'

echo "── a ws_… id, which is what the blueprint supplies"
refs="$(rebranded_refs wsid "{$base,\"orunWorkspace\":\"ws_ABCD1234\"}")"
[ "$refs" = "secret://ws_ABCD1234/acme-blog/" ] \
  && ok "every ref names ws_ABCD1234 and the product's own project" \
  || bad "refs after a ws_ rebrand: $(echo $refs)"

echo "── a slug"
refs="$(rebranded_refs slug "{$base,\"orunWorkspace\":\"ws_ABCD1234\",\"orunWorkspaceSlug\":\"acme\"}")"
[ "$refs" = "secret://acme/acme-blog/" ] \
  && ok "an explicit orunWorkspaceSlug wins" \
  || bad "refs with an explicit slug: $(echo $refs)"

echo "── no workspace at all"
refs="$(rebranded_refs none "{$base}")"
[ "$refs" = "secret://acme-blog/acme-blog/" ] \
  && ok "the repo name is the last resort — never the baseline's workspace" \
  || bad "refs with no workspace: $(echo $refs)"

echo "── and this tree has refs to rewrite at all"
n="$(cd "$root" && git grep -h -o -E 'secret://[^/"]+/virga/' -- '*component.yaml' | wc -l | tr -d ' ')"
[ "$n" -ge 10 ] && ok "$n refs in component.yaml files" \
  || bad "only $n secret refs found in this tree — the cases above proved nothing"

[ "$fail" -eq 0 ] || exit 1
echo "tenancy.test.sh: ok"
