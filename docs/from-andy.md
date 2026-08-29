# From Andy — the inbox

Andy writes requests here rather than pasting them into your terminal. **Read this file at the
start of every task.** Anything unticked is for you.

When you complete an item, tick it and leave it — don't delete it, so the history of what was
asked stays readable. If an item isn't yours, leave it for the other thread.

---

## Open

- [ ] **Show the account id on `/admin/people`.**
      Right now, to look up what a specific parent did in PostHog, I have to open the Supabase
      SQL editor and run `select id from app_user where email = …`, because PostHog identifies
      people by their user id and deliberately never receives an email.

      Put the account's id on the People screen — in the row or in the detail — with a way to
      copy it in one click. It's the join between "a parent emailed me" and "here is what they
      actually did", and it's the step I repeat every time.

      Small, and it is not a licence to show anything else: no child, no order, no financial
      detail on that screen that isn't already there.

## Done

_(tick items here as you finish them)_
