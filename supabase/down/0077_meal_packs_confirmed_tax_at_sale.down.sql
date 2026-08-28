-- Down for 0077. Blocks pack offers from going live again. Any offer already active stays active —
-- the guard is on the transition, not on the state — so this does not withdraw anything that is
-- already selling.
update platform_config set meal_packs_confirmed = false where id = 1;
