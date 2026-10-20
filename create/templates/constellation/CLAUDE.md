# Agent notes

A Zodiac constellation: TypeScript describing an org's Safes, Roles mods and permissions. `README.md` has the full API.

- Only values exported from `constellation/index.ts` are pushed.
- A new role needs its folder under `constellation/roles/`, an export in `constellation/roles/index.ts`, and an entry in the Roles mod's `roles`.
- `c.withinAllowance("<key>")` only works if that allowance is in the Roles mod's `allowances`.
- An allowance belongs to one Roles mod, and a policy enabled on several vaults has a Roles mod per vault. Each vault gets its own budget of every allowance the policy uses, so size an allowance per vault, not per policy.
- `allow.<chain>.<contract>` only knows contracts listed in `zodiac.config.ts`. After changing them, run `npm run pull-contracts`.
- Never edit `.zodiac/` or `abis/`: they're generated. Run `npm run pull` to refresh them.
- Import `constellation`, `allow`, `c` and the types from `@zodiaceco/sdk`; `custom`, `defikit`, `swap` and `transfer` from `@zodiaceco/sdk/actions`.
- Check an edit with `npx tsc --noEmit` and `npx zodiac push --dry-run`; neither needs an API key.
- Don't run `npm run push` unless asked: it sends the constellation to the org's Zodiac workspace.
