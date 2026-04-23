set shell := ["bash", "-cu"]

# List recipes
default:
    @just --list

# Pull the latest OpenAPI spec from production and regenerate the SKILL.md API reference.
# The plugin doesn't consume the spec directly — the SDK does — but we keep a
# snapshot so SKILL.md and README tables stay in sync with backend reality.
sync-spec:
    @echo "Fetching OpenAPI spec from https://api.sonz.ai/docs/openapi.json ..."
    @mkdir -p spec
    @curl -sfL https://api.sonz.ai/docs/openapi.json -o spec/openapi.json
    @echo "Updating SKILL.md API reference table from spec..."
    @bun run scripts/render-api-reference.ts
    @echo "Done. Diff:"
    @git diff --stat spec/openapi.json SKILL.md || true

# Bump patch (x.y.Z+1) from package.json and deploy.
patch:
    just deploy $(just _next patch)

# Bump minor (x.Y+1.0) from package.json and deploy.
minor:
    just deploy $(just _next minor)

# Bump major (X+1.0.0) from package.json and deploy.
major:
    just deploy $(just _next major)

# Full release: bump version, test, build, commit, publish to npm, tag, gh release.
# Requires: bun, npm (logged in), gh (authenticated).
# Usage: just deploy 1.2.3
deploy VERSION:
    @just _preflight {{VERSION}}
    @just _test
    @just _bump {{VERSION}}
    @just _build
    @just _commit {{VERSION}}
    git push origin main
    @just _publish {{VERSION}}
    @just _tag {{VERSION}}
    @just _release {{VERSION}}
    @echo "✓ Released v{{VERSION}}"

_preflight VERSION:
    @just _validate-version {{VERSION}}
    @just _check-clean
    @just _check-main
    @just _check-tag-free {{VERSION}}

_validate-version VERSION:
    #!/usr/bin/env bash
    set -euo pipefail
    if ! [[ "{{VERSION}}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "error: VERSION must match X.Y.Z (got: {{VERSION}})" >&2
      exit 1
    fi

_check-clean:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "$(git status --porcelain)" ]]; then
      echo "error: working tree is dirty; commit or stash first" >&2
      git status --short
      exit 1
    fi

_check-main:
    #!/usr/bin/env bash
    set -euo pipefail
    branch="$(git rev-parse --abbrev-ref HEAD)"
    if [[ "$branch" != "main" ]]; then
      echo "error: must be on main (current: $branch)" >&2
      exit 1
    fi

_check-tag-free VERSION:
    #!/usr/bin/env bash
    set -euo pipefail
    if git rev-parse --verify --quiet "v{{VERSION}}" >/dev/null; then
      echo "error: local tag v{{VERSION}} already exists" >&2
      exit 1
    fi
    git fetch origin --tags --quiet
    if git ls-remote --tags origin "refs/tags/v{{VERSION}}" | grep -q .; then
      echo "error: remote tag v{{VERSION}} already exists on origin" >&2
      exit 1
    fi

_test:
    bun run test

_bump VERSION:
    npm version {{VERSION}} --no-git-tag-version --allow-same-version >/dev/null
    @echo "bumped to {{VERSION}}"

_build:
    bun run clean
    bun run build

_commit VERSION:
    git add package.json package-lock.json
    git commit -m "release: v{{VERSION}}"

_publish VERSION:
    npm publish --access public

_tag VERSION:
    git tag -a v{{VERSION}} -m "Release v{{VERSION}}"
    git push origin v{{VERSION}}

_release VERSION:
    gh release create v{{VERSION}} --title "v{{VERSION}}" --generate-notes

# Print current version from package.json.
_current:
    #!/usr/bin/env bash
    set -euo pipefail
    npm pkg get version | tr -d '"'

# Compute next version from current by bumping patch|minor|major.
_next LEVEL:
    #!/usr/bin/env bash
    set -euo pipefail
    current=$(just _current)
    IFS=. read -r MAJ MIN PAT <<< "$current"
    case "{{LEVEL}}" in
      patch) PAT=$((PAT+1)) ;;
      minor) MIN=$((MIN+1)); PAT=0 ;;
      major) MAJ=$((MAJ+1)); MIN=0; PAT=0 ;;
      *) echo "error: LEVEL must be patch|minor|major (got {{LEVEL}})" >&2; exit 1 ;;
    esac
    echo "${MAJ}.${MIN}.${PAT}"
