# Gaps — what is proven about this baseline, and what is not

Written 2026-10-01, when Virga was split out of `sourceplane/cirrus` into this
repository, made public, and attached to its own workspace; revised
2026-10-15, when it was synced with cirrus-baseline and released as
`baseline-v1`. Every line under "proven" was
run, not inferred; every line under "not proven" names what would prove it.
Delete an entry when it stops being true — a gaps file that is never shortened
is a file nobody reads.

## Proven

| What | How |
|---|---|
| The build document is one orun can run. | `testing/placement.test.sh` places the whole blueprint with hooks off, under orun v2.60.0 (the floor) and v2.71.0. Baseline CI's `blueprint-runs` job repeats it on every pull request. |
| A product placed from it is a product. | The placed tree is branded as `01-scaffold` brands it: no factory path, no baseline identity, `intent.yaml` and all 18 secret refs naming the product's workspace. |
| That product builds. | A placed, branded product passed its own `install`, `wire:fixture`, `typecheck`, `lint`, `test` and `build`. Run by hand once; **not** a gate. |
| The static contract holds. | `coverage`, `phases`, `manifest`, `leak`, `retouch`, `tag-gate`, `tenancy` — all in Baseline CI. |
| This repository is attached to a workspace. | `orun workspace` resolves `ws_F6PEAMKD` (`virga`) from `intent.yaml`; `orun cloud check` reports `sourceplane/virga` allow-listed; `orun plan` resolves 16 components into 33 jobs. |
| CI reaches the platform without a credential. | With `ORUN_CI=true`, run 36834192908 planned 12 jobs and each run lane was answered by the platform: `secret resolution failed … Secret not found (code: not_found) [requestId: req_…]`. That is the answer a workspace with no minted secrets should give. |
| An unproven tag cannot be pushed. | The ruleset `baseline-tags-restrict-creation` refused `baseline-v0-ruleset-probe` from an org admin: `Cannot create ref due to creations being restricted`. |

## Not proven

### 1. No phase has ever run with its hooks on

Placement proves the document parses and the files land. It does not run
`orun.task/ensure`, `orun.repo/ensure`, `orun.pr/land`, `orun.run/watch`,
`orun.integrations/reconcile`, `orun.secrets/exists` or `orun.http/probe` —
which is everything a bootstrap does that is not copying a file. Two defects
that stopped the document at phase one (`repo:` on `orun.pr/land@v1`, and
`type: bool`) were found only because placement was finally run; the same
class of defect in a hook's *behaviour* is still unlooked-for.

*Would prove it:* one real `orun new --resume --run-hooks` into a throwaway
repository and workspace.

### 2. `baseline-v1` is cut from a commit no bootstrap has run

There is no rehearsal, and since the 2026-10-15 sync with cirrus-baseline
there is no gate asking for one: `tag.yml` cuts any `baseline-vN` that does
not already exist, and fitness to release is decided outside this repository
(cirrus-baseline#13 removed its rehearsal the same way, and cut v14 past the
gate by owner decision). `baseline-v1` was cut on that basis and registered
in orun-cloud as `virga`, **unlisted**: reachable by id in the console and
the CLI, listed to nobody, because nothing built from it has ever come up.

*Would prove it:* one real bootstrap from the published tag, then
`visibility: public` and a page on orunbase.com — not before.

Consequences that follow and are easy to forget:

- **`docs/phases/TIMINGS.md` and `expectedMinutes: 43` are estimates.** No
  bootstrap has been timed.
- **The lanes have never run on this repository.** `ci.yml` was ported to
  the lanes model (orun v2.78.0) with `ORUN_CI` unset, so the only CI that
  has run it is `plan`'s skip. A product built from Virga runs it for real.

### 3. The tag ruleset is gone, and nothing replaced it

The ruleset that restricted creation of `baseline-v*` had no bypass actor
(GitHub refuses the Actions integration on a bypass list), so it refused
`tag.yml` as surely as a hand push. It was deleted when the gate it guarded
was. Anyone with push can now push a tag by hand; `tag.yml` is the paved
road, not a fence. A GitHub App or a deploy key on a bypass list would make
it one again, and should, once a tag means a proven commit.

### 4. The workspace is not yet one a bootstrap can finish in

Cloudflare is connected (inherited from the account, `Nexo@sourceplane.ai's
Account`), and `orun baseline check cirrus` — the nearest registered
Cloudflare-only baseline — answers `ready to build` here. What is left:

- **The token's D1 Write permission group is unchecked.** Without it
  `03-infrastructure`'s `d1-edit` mint is refused with
  `parent_grant_insufficient`, and nothing short of a mint proves it either
  way. The `d1-edit` template is listed as active, which says the platform
  offers it, not that the connection's token can grant it.
- **GitHub is connected to the wrong account.** The only connection is
  inherited from the account and is to `pullely`, a user. The platform learns
  of a pull request through the App installation on the account that OWNS the
  repository — `sourceplane` — so `orun integrations list` says "github:
  active" and the landings would still not be filed.
- **No admin-role API key has been minted.** Builder and viewer keys read
  fine and have their secret writes denied, masked as `not_found`.
- **No secrets.** `orun secrets list` is empty, which is why every run lane
  above failed, and why `ORUN_CI` is **unset** again: the variable exists so a
  pre-bootstrap repository is not red, and this is one. Set it with
  `gh variable set ORUN_CI --body true` once this repository's own secrets
  exist.

### 5. This repository's own environments have never deployed

`intent.yaml` declares `dev`, `stage` and `prod` with `BASE_DOMAIN: virga.site`.
With `ORUN_CI` on, a push to `main` converges them for real. Whether the
`virga.site` zone exists in the connected Cloudflare account is unchecked.

### 6. Smaller things, written down so they are not rediscovered

- `kiox.lock` keeps `name: virga` in a product while `kiox.yaml` is renamed —
  the rebrand excludes lock files. Cirrus does the same. Harmless so far.
- The secret refs here use the workspace **slug** (`secret://virga/virga/…`).
  Since the 2026-10-15 sync the rebrand's rule matches any segment, a `ws_…`
  id included, so a baseline promoted from a product keeps working.
- `orun workspace create` cannot name an account, and a login that owns more
  than one is refused. This workspace was created with a locally patched CLI
  that sends `accountId`. The released CLI still cannot do it.
- **This repository is public because its workspace is.** `virga` is under the
  openproduct account, whose workspaces are public and whose covenant is that
  their repositories are too. It was made public on 2026-10-01 for that reason;
  its tree was already public inside `sourceplane/cirrus`. Making it private
  again breaches the covenant — move it to a workspace under a standard account
  first.
