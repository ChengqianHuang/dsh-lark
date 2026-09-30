# Contributing

English | [简体中文](CONTRIBUTING.zh-CN.md)

Useful contributions include reproducible bugs, onboarding improvements, focused tests, and improvements to chat control or delivery. Describe the user problem and one observable result before proposing a large feature.

## Develop locally

Use Node.js `^22.19.0 || >=24.0.0` and the pnpm version recorded in [package.json](package.json). Dependencies are pinned to the supported dsh release; this repository can be developed outside a harness checkout.

```sh
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` runs type checking, tests, a build, and package/import checks. Tests use synthetic Lark events and fake child processes; no app credentials or live chat account are required. A real-tenant smoke test is separate and must be explicitly authorized before sending messages.

To try a local change, run `pnpm build`, link the checkout as shown in the [quickstart](README.md#use-this-package), and restart the host. Use a dedicated bot and workspace for manual testing.

## Prepare a change

Keep each pull request focused on one user-visible outcome. Include a failing regression case for a bug; cover cancellation and cleanup when changing asynchronous code. Use event-driven test synchronization and await every child process and session created by a test.

Update the affected English and Chinese documentation together. Document configuration defaults and resource ownership where users depend on them. Record a substantial design decision in `.agents/notes/implemented/<kind>/` with the problem, decision, alternatives considered, and consequences. Keep generated build output and credentials out of Git.

Before opening a pull request, run `pnpm check` and `git diff --check`. In the description, explain the resulting behavior, the checks actually run, and any live behavior left unverified. Do not claim a tenant integration passed based only on mock tests.

## Report a bug or propose a feature

Use the [issue forms](https://github.com/ChengqianHuang/dsh-lark/issues/new/choose). Include versions and a minimal redacted configuration for bugs; include the chat workflow and desired result for features. Share security-sensitive findings through [SECURITY.md](SECURITY.md).

## Package locally

```sh
pnpm pack
```

The tarball includes the built plugin and profile patch. It can be installed through `dsh plugin --profile web add /absolute/path/to/dsh-lark-<version>.tgz`. Publishing a release or package requires the maintainer's approval; the repository's check workflow does not publish.
