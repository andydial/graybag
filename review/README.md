# review/

Generated proposals waiting on a human. **Nothing in here has been applied to any database.**

Each file is produced by a script, carries its own confidence, and is safe to apply as-is or to
edit first. They are committed so that the proposal Andy reviews is the exact one that was
generated, rather than something regenerated later against different data.

| File | Made by | Applies with |
|---|---|---|
| `food-types.csv` | `scripts/propose-food-types.mjs` | `node tools/bulk-import/src/cli.mjs --dishes review/food-types.csv --apply` |
| `food-types.md` | the same | reading — it is the CSV grouped by how much attention each row needs |
