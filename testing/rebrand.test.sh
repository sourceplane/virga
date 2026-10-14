#!/usr/bin/env bash
# THE REBRAND WRITES EACH VALUE ONCE, WHAT IT WROTE STAYS WRITTEN, AND THE
# NAME IT RENAMES AWAY FROM IS DECLARED, NOT HARDCODED.
#
# Three things, each found live in Cirrus and ported with the engine:
#
# 1. A `secret://<workspace>/<project>/<env>/<KEY>` ref is verified by the
#    platform's resolve against the run's own workspace — by slug, public id
#    or ws_ ref. The blueprint hands rebrand.mjs the workspace as a ws_… id,
#    and the workspace segment of the baseline's OWN refs can be a ws_… id too
#    (a baseline promoted from a product carries that product's). The rule
#    must match any segment and write the product's.
#
# 2. The rules run in sequence, and each used to write its value where every
#    LATER rule could match it again. A product whose repo slug contains the
#    baseline word (`virga-e2e`) was renamed twice, and a bootstrap re-runs
#    the rebrand over the whole tree in every phase, so even a value written
#    correctly once was mangled by the next pass. Written values are held as
#    opaque tokens until the last rule has run.
#
# 3. The FROM side of every rule is read from `.baseline/identity.json`,
#    resolved against the script's own location. A product promoted to be the
#    next baseline declares its identity there and the engine renames away
#    from it; nothing in the script says `virga`.
#
# This drives the real rebrand.mjs over a one-file tree and compares the file.
# Every fixture pins the baseline identity it is written against, so the suite
# says the same thing in any baseline that carries this engine.
# Needs: node, git. No network.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
rebrand="$here/../tooling/rebrand/rebrand.mjs"

command -v node >/dev/null || { echo "rebrand.test.sh needs node" >&2; exit 1; }

identity="$here/fixtures/baseline-identity.virga.json"
fail=0

# check NAME VALUES-JSON FILE CONTENT WANT [PASSES]
#   PASSES — how many times the rebrand runs over the tree (default 1). A
#   bootstrap runs it once per phase, over everything already placed.
check() {
  local name="$1" values="$2" file="$3" content="$4" want="$5" passes="${6:-1}"
  local tmp got out i
  tmp="$(mktemp -d)"
  git -C "$tmp" init -q
  mkdir -p "$tmp/$(dirname "$file")" "$tmp/.rebrand"
  printf '%s\n' "$content" > "$tmp/$file"
  printf '%s\n' "$values" > "$tmp/.rebrand/values.json"
  for ((i = 1; i <= passes; i++)); do
    git -C "$tmp" add -A
    if ! out="$(cd "$tmp" && node "$rebrand" --baseline-identity "$identity" --values .rebrand/values.json --allow-dirty 2>&1)"; then
      echo "   ✕  $name: rebrand pass $i failed:" >&2
      printf '%s\n' "$out" | sed 's/^/        /' >&2
      fail=1
      rm -rf "$tmp"
      return
    fi
  done
  got="$(cat "$tmp/$file")"
  rm -rf "$tmp"
  if [ "$got" = "$want" ]; then
    echo "   ok  $name"
  else
    echo "   ✕  $name:" >&2
    echo "        got:  $got" >&2
    echo "        want: $want" >&2
    fail=1
  fi
}

base='"reponame":"acme-blog","productname":"Acme Blog","productdomain":"acme.blog"'
ref='TOKEN: secret://virga/virga/stage/CLOUDFLARE_API_TOKEN'

echo "── rebrand: secret-ref workspace segment"
check "a ws_ id is the workspace segment" \
  "{$base,\"orunWorkspace\":\"ws_79BDXAZQ\"}" apps/w/component.yaml "$ref" \
  "TOKEN: secret://ws_79BDXAZQ/acme-blog/stage/CLOUDFLARE_API_TOKEN"
check "an explicit slug wins" \
  "{$base,\"orunWorkspace\":\"ws_79BDXAZQ\",\"orunWorkspaceSlug\":\"acme-space\"}" apps/w/component.yaml "$ref" \
  "TOKEN: secret://acme-space/acme-blog/stage/CLOUDFLARE_API_TOKEN"
check "a slug given as the workspace is kept" \
  "{$base,\"orunWorkspace\":\"acme-space\"}" apps/w/component.yaml "$ref" \
  "TOKEN: secret://acme-space/acme-blog/stage/CLOUDFLARE_API_TOKEN"
check "no workspace at all falls back to the repo name, never the baseline's" \
  "{$base}" apps/w/component.yaml "$ref" \
  "TOKEN: secret://acme-blog/acme-blog/stage/CLOUDFLARE_API_TOKEN"

echo "── rebrand: a baseline whose own refs name a ws_ id"
# A baseline promoted from a product built in workspace ws_KWQ45Z6M carries
# `secret://ws_KWQ45Z6M/<slug>/…`. A rule matching only a lowercase slug there
# never fired; the repo-slug rule then renamed the project alone and every
# product's refs still named the baseline's workspace (cirrus-baseline, v15).
wsref='TOKEN: secret://ws_KWQ45Z6M/virga/stage/CLOUDFLARE_D1_TOKEN'
check "the baseline's ws_ workspace becomes the product's" \
  "{$base,\"orunWorkspace\":\"ws_KCR13BW3\"}" infra/terraform/d1/component.yaml "$wsref" \
  "TOKEN: secret://ws_KCR13BW3/acme-blog/stage/CLOUDFLARE_D1_TOKEN"
check "…and stays the product's through every later phase's pass" \
  "{$base,\"orunWorkspace\":\"ws_KCR13BW3\"}" infra/terraform/d1/component.yaml "$wsref" \
  "TOKEN: secret://ws_KCR13BW3/acme-blog/stage/CLOUDFLARE_D1_TOKEN" 3

echo "── rebrand: a written value is not rewritten"
e2e='"reponame":"virga-e2e","productname":"Virga E2E","productdomain":"virga-e2e.dev"'
check "a repo slug containing the baseline word survives the repo-slug rule" \
  "{$e2e,\"orunWorkspace\":\"ws_79BDXAZQ\"}" apps/w/component.yaml "$ref" \
  "TOKEN: secret://ws_79BDXAZQ/virga-e2e/stage/CLOUDFLARE_API_TOKEN"
check "…and survives every later phase's pass" \
  "{$e2e,\"orunWorkspace\":\"ws_79BDXAZQ\"}" apps/w/component.yaml "$ref" \
  "TOKEN: secret://ws_79BDXAZQ/virga-e2e/stage/CLOUDFLARE_API_TOKEN" 3
check "a product name containing the brand word survives the brand-word rule" \
  "{$e2e}" README.md 'Welcome to Virga.' \
  'Welcome to Virga E2E.' 3
check "a domain containing a baseline word survives the repo-slug rule" \
  '{"reponame":"acme","productname":"Acme","productdomain":"virga-weather.dev"}' \
  apps/w/wrangler.template.jsonc '"BASE_DOMAIN": "virga.site"' \
  '"BASE_DOMAIN": "virga-weather.dev"' 3
check "a worker name is prefixed by the brand slug, and the D1 name by the repo slug" \
  '{"reponame":"acme-blog","productname":"Acme Blog","productdomain":"acme.blog","brandSlug":"acme"}' \
  apps/site-api/wrangler.template.jsonc '"name": "virga-site-api", "db": "virga-stage"' \
  '"name": "acme-site-api", "db": "acme-blog-stage"'

echo "── rebrand: the FROM side is the declared identity"
saved_identity="$identity"
identity="$here/fixtures/baseline-identity.acme-blog.json"
promoted='"reponame":"northwind","productname":"Northwind","productdomain":"northwind.io","orunWorkspace":"ws_NW000001"'
check "a promoted baseline renames away from ITS identity, not from virga" \
  "{$promoted}" apps/w/component.yaml 'secret://ws_KWQ45Z6M/acme-blog/stage/K — mail.acme.blog — name: "Acme Blog" — ACME_BLOG_OWNER_TOKEN' \
  'secret://ws_NW000001/northwind/stage/K — mail.northwind.io — name: "Northwind" — NORTHWIND_OWNER_TOKEN'
check '…and a `virga` in that tree is just a word to it' \
  "{$promoted}" README.md 'born from virga' \
  'born from virga'
identity="$saved_identity"

echo "── rebrand --verify knows the product's own identity when given its values"
tmp="$(mktemp -d)"
git -C "$tmp" init -q
mkdir -p "$tmp/.rebrand"
printf '%s\n' "{$e2e,\"orunWorkspace\":\"ws_79BDXAZQ\"}" > "$tmp/.rebrand/values.json"
printf 'name: virga-e2e\n' > "$tmp/package.json"
git -C "$tmp" add -A
if (cd "$tmp" && node "$rebrand" --baseline-identity "$identity" --verify --values .rebrand/values.json) >/dev/null 2>&1; then
  echo "   ok  a product named virga-e2e passes --verify with its values"
else
  echo "   ✕  --verify flagged the product's own name as residue" >&2; fail=1
fi
if (cd "$tmp" && node "$rebrand" --baseline-identity "$identity" --verify) >/dev/null 2>&1; then
  echo "   ✕  --verify without values let \`virga\` through" >&2; fail=1
else
  echo "   ok  …and without them the same word is residue, as it should be"
fi
rm -rf "$tmp"

[ "$fail" -eq 0 ] || exit 1
echo "rebrand.test.sh: ok"
