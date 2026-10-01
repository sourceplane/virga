# Gaps — what is proven about this baseline, and what is not

Written 2026-10-01, when Virga was split out of `sourceplane/cirrus` into this
repository, made public, and attached to its own workspace. Every line under "proven" was
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

### 2. There is no rehearsal, so there is no tag — deliberately, for now

`rehearsal.yml` and `testing/rehearsal/` are not ported from Cirrus. The tag
gate therefore answers exit 3, "the question could not be answered", for every
commit, and `baseline-v1` does not exist. Left out on purpose at the split: a
harness that creates and destroys real Cloudflare resources should not be
written without being run.

Consequences that follow from it and are easy to forget:

- **Virga is not in the registry.** `orun baseline list` shows `cirrus`,
  `lumen` and `multi-tenant-saas`. A row in orun-cloud's
  `infra/baselines-registry/baselines.yaml` needs a tag to pin, and the sync
  refuses a tag that does not exist. Nobody can build from Virga through the
  console until this is closed.
- **`docs/phases/TIMINGS.md` and `expectedMinutes: 43` are estimates.** No
  bootstrap has been timed.

### 3. The tag ruleset is binding in one direction only

The ruleset restricts creation of `baseline-v*` and has **no bypass actor**.
GitHub refuses the Actions integration on a bypass list (`Actor GitHub Actions
integration must be part of the ruleset source or owner organization`), so
"`tag.yml`'s token is the only creator" cannot be expressed with
`GITHUB_TOKEN`. Today that costs nothing, because the gate refuses everything.
The day a rehearsal goes green, `tag.yml`'s `cut` job will pass the gate and
then be refused by the ruleset.

*Closes it:* a GitHub App or a deploy key on the bypass list, and `cut`
creating the tag with that identity. It also only restricts **creation** —
moving an existing tag is not restricted, and should be once one exists.

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
- The secret refs here use the workspace **slug** (`secret://virga/virga/…`)
  on purpose: the rebrand's scoped rule matches `[a-z0-9-]+`, so a `ws_…` id
  in that segment would not be rewritten and a product would keep this tenant.
- `orun workspace create` cannot name an account, and a login that owns more
  than one is refused. This workspace was created with a locally patched CLI
  that sends `accountId`. The released CLI still cannot do it.
- **This repository is public because its workspace is.** `virga` is under the
  openproduct account, whose workspaces are public and whose covenant is that
  their repositories are too. It was made public on 2026-10-01 for that reason;
  its tree was already public inside `sourceplane/cirrus`. Making it private
  again breaches the covenant — move it to a workspace under a standard account
  first.
