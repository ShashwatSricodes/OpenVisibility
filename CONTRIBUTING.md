# Contributing to OpenVisibility

Thanks for helping. This guide covers setup, the checks every change must pass, and how changes get merged.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

You don't need any API keys to work on the UI or run the tests. Provider keys are only needed to run the spikes against real services.

## Before you open a pull request

Run all four checks; CI will run the same ones:

```bash
npm run lint
npm run typecheck
npm test
npm run format:check
```

- **Tests must not call real services.** Use the recorded responses in `scripts/fixtures/` instead.
- **Never commit keys.** Put them in `.env.local`, which git ignores. Check new fixtures for anything secret before committing them.
- **Keep provider details in one place.** Model IDs, dataset IDs and per-call costs change often; they belong in `core/providers/`, not scattered through the code.

## How changes are organized

- One branch per piece of work, for example `day-07-claude-adapter` or `fix-ai-mode-country`.
- Small, focused commits with messages that say what changed and why.
- Pull requests are merged into `main` once checks pass and the change is reviewed.

## Licensing and the CLA

OpenVisibility is licensed under [AGPL-3.0](LICENSE). Hosted-only code in `ee/` is under a separate commercial license.

Because the same codebase is offered under both licenses, contributors will be asked to sign a Contributor License Agreement (CLA) before their first pull request is merged. The CLA bot is being set up; until then, maintainers will ask you in the pull request.

## Reporting problems

Open a GitHub issue with what you ran, what you expected and what happened. For anything security-related, don't open a public issue; contact the maintainer directly.
