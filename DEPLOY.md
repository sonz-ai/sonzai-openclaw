# DEPLOY — sonzai-openclaw

## The rule

**Never release manually. Always use `just patch`.**

```bash
just patch              # bump patch, test, build, commit, push, npm publish, tag, gh release
just deploy 1.3.3       # same, for an explicit version
```

That runs the complete pipeline in order:

1. Preflight (version format, clean tree, on `main`, tag free)
2. `vitest run`
3. Bump `package.json` version + `SKILL.md` `version:` frontmatter
4. Clean + build (`tsup`)
5. Commit `release: vX.Y.Z`
6. `git push origin main`
7. `npm publish --access public` (package: `@sonzai-labs/openclaw-context`)
8. Annotated tag `vX.Y.Z` + push
9. `gh release create vX.Y.Z --generate-notes`

Skip any step and the release is incomplete.

## Don't

- Don't manually edit `package.json`'s `version` and commit. `_bump` also
  updates the `version:` frontmatter in `SKILL.md`.
- Don't `npm publish` without tagging + running `gh release create`.
- Don't `git tag` manually — let `_tag` do it.
- Don't bump the `@sonzai-labs/agents` peer-dep floor in the same commit
  as a version bump — that's a dependency update and deserves its own
  commit.
- Don't bump minor/major without explicit user approval.

## Recovering a half-manual release

If someone already bumped + committed + pushed + tagged but skipped npm /
gh release (this happened on v1.3.1 and v1.3.2), run the missing steps:

```bash
just _publish 1.3.2
just _release 1.3.2
```

Or — cleaner — skip ahead with `just patch` to `1.3.3`.

## Spec sync

`just sync-spec` is a separate concern — pulls the latest `openapi.json`,
regenerates the API-reference table in `README.md` / `SKILL.md`. Does NOT
bump the version or publish.

## See also

[`../sonzai-sdk/DEPLOY.md`](../sonzai-sdk/DEPLOY.md) — canonical guide
covering all four repos (sonzai-typescript, sonzai-python, sonzai-go,
sonzai-openclaw).
