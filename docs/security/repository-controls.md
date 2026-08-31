# Repository and npm release controls

This runbook separates controls committed in the repository from settings that
an npm package owner or GitHub repository administrator must enable. A pull
request cannot truthfully claim the administrative controls are active. Record
redacted API output and links to the successful runs when completing issues
#96, #98, #99, and #104.

## Prerequisites

1. Add a second trusted human with `write` or `maintain` permission. Confirm that
   the person can review changes authored by `@duluca` before enabling a
   no-bypass, one-approval rule.
2. Merge the release, CodeQL, `CODEOWNERS`, package-policy, and security-policy
   files. Run CodeQL on `main` and resolve every open high or critical result.
3. Confirm every non-local action reference in `.github/workflows` is an exact
   40-character commit and belongs to the reviewed GitHub-owned allowlist.

## npm trusted publisher and protected environment

In the npm package settings for `document-ts`, configure one trusted publisher
with these exact values:

| Field         | Value          |
| ------------- | -------------- |
| Provider      | GitHub Actions |
| Owner         | `duluca`       |
| Repository    | `document-ts`  |
| Workflow file | `release.yml`  |
| Environment   | `npm-release`  |

Create the GitHub environment `npm-release`, restrict it to protected version
tags, and require a human reviewer. Do not add a registry password or reusable
publication credential to the environment. The workflow requests only source
read access and an OIDC identity token.

After a package owner approves the first OIDC publication:

1. Compare the workflow artifact, registry download, GitHub release attachment,
   integrity value, and checksums. They must all identify the same bytes.
2. Inspect the npm package access log and provenance statement. They must name
   `duluca/document-ts`, `.github/workflows/release.yml`, `npm-release`, the
   signed version tag, and its commit.
3. Revoke the superseded npm automation token, confirm its identifier is absent
   from `npm token list`, remove every legacy CI-provider npm context, and
   disable traditional token publication for the package.

## Actions and branch governance

Configure repository Actions settings with read-only default workflow access,
workflow pull-request approval disabled, policy set to selected actions, and
commit-SHA pinning required. Allow GitHub-owned actions only; add an exception
only after recording its owner, immutable revision, permissions, and review.

Create an active `main` ruleset with no bypass actors. Require:

- a pull request and one approval from a person other than the author;
- dismissal of stale approvals and a new approval after the last push;
- resolved conversations and review from `CODEOWNERS` for owned paths;
- verified commit signatures and linear history;
- `CI policy`, `Build, test, coverage, and package`, `No-egress policy`,
  `No-egress test`, `DeepScan`, and the observed CodeQL JavaScript/TypeScript
  check; and
- a `code_scanning` rule for tool `CodeQL` with
  `security_alerts_threshold: high_or_higher` and `alerts_threshold: errors`,
  so a missing or running analysis and high or critical findings block merge;
  and
- blocked force pushes and deletion, including for administrators.

Create a second active ruleset for tags matching `v*`, also with no bypass
actors. Block updates and deletion, require a verified signature on the target,
and allow creation only from a commit reachable from `main`. The release script
independently rejects an unsigned or non-annotated tag, a version mismatch, a
dirty checkout, or a commit that is not reachable from `origin/main`.

Do not activate the no-bypass approval rule until the second trusted human is
eligible to approve. That prerequisite is a safety control, not an optional
follow-up.

## Immutable GitHub releases

Enable immutable releases in the repository settings only after the hardened
GitHub release workflow is on `main`. The workflow deliberately creates a
draft, attaches the complete verified evidence set, and publishes only after
every upload succeeds. It refuses to replace an existing release. These steps
are compatible with immutability, but the repository setting is an external
administrative control and this pull request does not claim it is enabled.
Immediately before creating the draft, the workflow rechecks the signed tag and
refuses to proceed unless the immutable-releases API reports `enabled: true`
and an active repository `refs/tags/v*` ruleset has no bypass actors, blocks tag
updates and deletion, and requires signatures.

After enabling the setting, retain redacted output from the immutable-releases
repository API showing `enabled: true`. On the next release, run
`gh release verify <tag>` and `gh release verify-asset <tag> <file>` for every
attached file, and attach the successful command output to issue #104.

## Secret scanning and CodeQL

Enable all four repository security settings through the GitHub UI or repository
API: secret scanning, push protection, validity checks, and non-provider
patterns. The committed CodeQL workflow analyzes JavaScript and TypeScript with
the `security-extended` suite for pull requests into `main`, pushes to `main`,
and a weekly schedule. Confirm the code-scanning API reports zero open high or
critical results before enabling the ruleset. A required status check alone is
not the severity gate: closing evidence must show the active `code_scanning`
rule and its `high_or_higher` security threshold.

### Push-protection proof

Run this test only after the API reports push protection enabled. It creates a
new RSA private key in a temporary directory, never registers it with any
service, and attempts to push it on a uniquely named temporary branch. Use an
isolated clone. The expected result is a rejected push and no matching remote
reference.

```bash
test_dir="$(mktemp -d /tmp/document-ts-push-protection.XXXXXX)"
branch="security/push-protection-proof-$(date -u +%Y%m%d%H%M%S)"
trap 'chmod -R u+w "$test_dir"; rm -rf -- "$test_dir"' EXIT
git clone https://github.com/duluca/document-ts.git "$test_dir/repo"
cd "$test_dir/repo"
git switch --create "$branch"
ssh-keygen -q -t rsa -b 3072 -N '' -f "$test_dir/throwaway_rsa"
cp "$test_dir/throwaway_rsa" push-protection-proof.pem
git add push-protection-proof.pem
git commit -S -m 'test: verify push protection rejects a throwaway key'
if git push origin "HEAD:refs/heads/$branch"; then
  git push origin --delete "$branch"
  echo 'FAIL: push protection allowed the key; the unexpected ref was removed' >&2
  exit 1
fi
if git ls-remote --exit-code origin "refs/heads/$branch"; then
  echo 'FAIL: the rejected push still created a remote ref' >&2
  exit 1
fi
```

The trap destroys both copies of the local key. Capture the rejected push URL
and the empty remote-ref check, but never retain or attach the private key.

## Closing evidence

Attach redacted responses for repository security settings, Actions permissions
and allowlist, collaborator roles, branch and tag rulesets, branch protection,
CodeQL alerts, the protected environment, npm trusted-publisher configuration,
the immutable-releases setting and verification output, the revoked token list,
and package access history. Redaction must preserve the field names and control
values needed to evaluate every acceptance criterion.
