# Project workflow

These rules apply to every task in this repository until the project ends.

## After finishing a task

1. **Commit.** Always finish completed work with a commit. Write one or two
   concise sentences explaining *why* the change was made, not just what changed.
2. **Push.** Immediately push the commit to `origin main`
   (`https://github.com/belyse01/job-connect.git`). Do not leave finished work
   sitting only on the local machine.
3. **Report.** In the final message, state the commit message used and the push
   result.

## Notes

- Do not commit `backend/data/` (database and uploaded CVs) — it is git-ignored.
- `.shots/` holds local review screenshots and is not part of the app source;
  keep it out of commits unless explicitly asked.
- If a check (test, build, server boot) fails, fix it before committing rather
  than committing broken work.
