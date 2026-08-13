-- Rollback for 0029 — Gem and Paragon go back to closed for ordering.
--
-- Deleting the four provisional rows is safe **only while nothing references them**, and the
-- delete cannot silently break that rule: `"order".break_time_id` is `on delete restrict`, so a
-- window that has been ordered against raises a foreign-key error here rather than taking an
-- order's delivery window with it. (`break_time_class` cascades, but v1 never writes it.) The
-- error is the correct outcome — if a parent has ordered against a provisional window, it is no
-- longer provisional in any sense that matters, and the right response is to confirm the times
-- with the school, not to roll them back.
--
-- Matched on `code like '%-provisional'` for the two schools, so a window an operator has since
-- confirmed and renamed is left alone.
delete from break_time
 where school_id in ('79752fe3-841f-45b6-a47b-1169ce70e648',   -- Gem Public School
                     '50994394-8557-4985-a76f-707d16a83c1a')   -- Paragon Senior Secondary
   and code like '%-provisional';

-- Amity's labels go back to the raw ranges out of the export. Guarded on the friendly name, so a
-- label somebody has since edited is not clobbered by a rollback of an unrelated change.
update break_time set label = '10:40AM - 11:15AM', updated_at = now()
 where school_id = '77308e75-d8e9-47ba-a503-7c38d482a72c'
   and code = 'break-1'
   and label = 'Morning break';

update break_time set label = '11:15AM - 11:40AM', updated_at = now()
 where school_id = '77308e75-d8e9-47ba-a503-7c38d482a72c'
   and code = 'break-2'
   and label = 'Second break';

comment on column break_time.code is null;
