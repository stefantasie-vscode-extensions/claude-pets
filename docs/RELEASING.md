# Releasing

Releases are built and published by the GitHub Actions workflow
[`.github/workflows/publish.yml`](../.github/workflows/publish.yml) whenever a version tag
(`v1.2.3`) reaches the GitHub repository. The workflow runs the tests, checks that the tag matches
the version in `package.json`, packages the `.vsix`, attaches it to a GitHub release (notes taken
from `CHANGELOG.md`) and publishes it to the Visual Studio Marketplace. Re-running it for the same
version is safe (`--clobber`, `--skip-duplicate`).

## One-time setup: Marketplace authentication

The workflow uses the first option that is available.

### Option 1 – Trusted Publishing (recommended)

No secret is stored anywhere; GitHub proves the workflow's identity to the Marketplace (OpenID
Connect). On the [publisher page](https://marketplace.visualstudio.com/manage/publishers/stefantasie):

1. Select **Trusted Publishing** and expand **Create**.
2. Enter:
   - **Policy name:** `Release workflow`
   - **Repository owner:** `stefantasie-vscode-extensions`
   - **Repository:** `claude-pets`
   - **Workflow:** `publish.yml`
   - **Environment:** leave empty
3. Select **Create**.

### Option 2 – Personal access token (transitional)

Create a token in Azure DevOps (`https://dev.azure.com` → User settings → Personal access tokens)
with **Organization: All accessible organizations** and the scope **Marketplace → Manage**, and
store it as the repository secret `VSCE_PAT` (GitHub → Settings → Secrets and variables →
Actions). If this secret exists, the workflow uses it instead of Trusted Publishing.

Microsoft retires these global tokens on 1 December 2026; after that only Trusted Publishing
remains for GitHub Actions. Delete the secret once Trusted Publishing works.

## Publishing a release

1. Set the new version: `npm version 1.2.3 --no-git-tag-version` and update
   `scripts.install-local` in `package.json`.
2. Add a `## 1.2.3 – YYYY-MM-DD` section at the top of `CHANGELOG.md`.
3. Commit, then tag: `git tag -a v1.2.3 -m "Claude Pets 1.2.3"`.
4. Push `main` and the tag to Gitea (`git push origin main v1.2.3`) and to GitHub, either through
   the Gitea push mirror or directly
   (`git push git@github.com:stefantasie-vscode-extensions/claude-pets.git main v1.2.3`).
5. Watch the run under **Actions** on GitHub.

## README on GitHub and in the Marketplace

Content that should only appear on GitHub (for example the Marketplace button) goes between
`<!-- github-only -->` and `<!-- /github-only -->` in `README.md`. `npm run package` strips these
blocks for the packaged description.

## Manual fallback

`npm run package` creates `claude-pets-<version>.vsix`. On the publisher page choose
**New extension → Visual Studio Code** for the first upload, or **Update** for a new version, and
upload the file.
