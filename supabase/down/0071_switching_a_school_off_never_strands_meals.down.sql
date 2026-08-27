-- Down for 0071.
--
-- **Applying this makes a withdrawn offer strand paid-for meals**, if the app is gating on
-- `meal_pack_surface`. Without `parent_has_live_meal_pack` there is no way to ask "does this
-- parent hold meals" separately from "do we still sell packs here", and the two questions
-- collapse back into one — which is the bug 0071 exists to prevent.

drop function if exists meal_pack_surface(uuid, uuid);
drop function if exists parent_has_live_meal_pack(uuid);
