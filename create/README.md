# @zodiaceco/create

Starts a [Zodiac](https://zodiac.eco) constellation project: your organisation's onchain accounts, roles, and permissions as code.

```bash
npm create @zodiaceco@latest my-org
```

`pnpm dlx @zodiaceco/create` and `bunx @zodiaceco/create` work the same, installing with pnpm or Bun, as does `zodiac create` from [`@zodiaceco/sdk`](https://www.npmjs.com/package/@zodiaceco/sdk).

It copies the constellation template into `my-org`, installs its dependencies with the package manager you ran it with, and offers to connect the project to Zodiac: that opens your browser to sign in, mints an API key for the project and pulls your org's accounts. Last, it commits the project to a new git repository.

| Option         | What it does                                                     |
| -------------- | ---------------------------------------------------------------- |
| `--pm <name>`  | install with `npm`, `pnpm`, `yarn` or `bun` instead              |
| `--no-install` | don't install dependencies                                       |
| `--no-git`     | don't initialize a git repository                                |
| `--no-auth`    | don't connect the project to Zodiac                              |
| `--overwrite`  | empty a directory that isn't empty (keeping its `.git`)          |
| `-y, --yes`    | don't ask, take the defaults (as without a terminal, e.g. in CI) |

Without a terminal, or with `--yes`, it never connects to Zodiac, since that needs a browser. Run `npm run pull` in the project to do it later.

The template lives in [`templates/constellation`](./templates/constellation).
