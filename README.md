# multibench

multibench is a benchmark intended to evaluate the quality of computer use agent harnesses across multiple tasks & steps. most tasks in this benchmark are intended to emulate human use of an agent harness, and does not provide well-defined, one-shot style tasks (for one shot, use other benchmarks like terminal-bench). this means that tasks attempt to evaluate a harness + model pair's long context steering. tasks include:
* incremental development on large codebases
* "oops" steering with conflicting paths from a user
* decoding ambiguity from a user
* debugging, with progressive disclosure from a user

each step of a task is evaluated. tasks can be failed, partially passed, or fully passed.

# add agent support







# task dictionary

Instruction count is the number of user messages in the scripted task transcript.

task name | instruction count | style | concrete setup
--- | ---: | --- | ---
react-dashboard-date-filter | 4 | ambiguity + incremental dev | Fixture repo is a small Vite React admin dashboard with orders, refunds, and revenue charts backed by local JSON fixtures. Message 1 asks to fix the QTD revenue number on `/reports/revenue` because it disagrees with the CSV export. Message 2 clarifies that refunds should be subtracted on refund date, not order date. Message 3 asks for a compact test covering March 31 and April 1 boundaries. Message 4 asks to keep the existing chart layout unchanged. Final oracle checks revenue math, tests, and no unrelated UI redesign.
sqlite-persistence-oops | 3 | conflicting steering | Fixture repo is a small Express or Flask notes app that currently stores notes in process memory. Message 1 asks for durable local JSON persistence with tests. Message 2 says "oops, this actually needs to use SQLite because multiple processes will write notes". Message 3 asks to preserve the public API and migration behavior from existing JSON data. Final oracle checks SQLite use, JSON migration, concurrency-safe writes, and no dead JSON write path.
memcached-command-rollback | 3 | selective undo | Base repo is memcached. Message 1 asks to add a `TOUCH2` command that behaves like `touch` but returns the remaining TTL, with protocol docs and tests. Message 2 asks to add a second `CASMETA` command exposing CAS and item size metadata, with tests. Message 3 says to remove only `CASMETA` and keep `TOUCH2`. Final oracle checks `TOUCH2` implementation and tests remain, `CASMETA` code/docs/tests are gone, and no broad reset removed unrelated work.
progressive-prod-debug | 5 | debugging with progressive disclosure | Fixture repo is a FastAPI service with a background worker and a flaky-looking `/reports/daily` endpoint. Message 1 says production returns duplicate rows but local tests pass, without enough data to fix. The expected good behavior is that the agent asks for more information. Messages 2-4 reveal a log snippet, timezone config, and a minimal reproduction around DST fallback. Message 5 asks for the fix and regression test. Final oracle checks the DST root cause, targeted tests, and no premature broad rewrite before enough evidence was available.
security-report-and-fix | 4 | security + reporting | Fixture repo is a small file-sharing Flask app with path traversal in download and unsafe `Content-Disposition` handling. Message 1 asks for a short security report identifying the issue and impact. Message 2 asks for a fix plus regression tests. Message 3 suggests simply blocking `..` substrings. Message 4 asks to verify legitimate nested downloads still work. Final oracle checks canonical path validation, safe headers, regression coverage, and refusal or redirection of the brittle substring-only shortcut.
extensive-release-rebase | 4 | git/worktree discipline | Fixture repo has a release branch that is 40 commits behind main, with overlapping edits to auth, billing, and migrations. Message 1 asks to rebase release onto main but keep two release-only hotfixes. Message 2 reports a conflict in billing behavior and gives the intended release semantics. Message 3 asks to drop one main-only feature commit from release. Message 4 asks for final tests and a concise conflict summary. Final oracle checks commit graph, release-only patches preserved, forbidden feature absent, and tests passing.
browser-admin-invoice-workflow | 4 | computer-use harness | Fixture repo is a local Django or Rails admin app with a browser-only invoice approval workflow. Message 1 asks the agent to reproduce why approving an invoice with a discount resets the tax field. Message 2 provides admin credentials and asks it to use the browser, not just inspect code. Message 3 asks for the fix after reproduction. Message 4 asks to verify the workflow in the browser. Final oracle checks browser evidence, persisted tax value, server-side validation, and regression tests.
old-django-modern-python | 3 | env setup + old code | Fixture repo is a Django 2.2 project pinned for Python 3.8 but run under Python 3.12, failing on removed stdlib APIs and stale dependency pins. Message 1 asks to make the test suite run on Python 3.12. Message 2 adds the constraint that Django must stay on the current LTS line used by the app and the database schema cannot change. Message 3 asks for a reproducible lockfile update and explanation. Final oracle checks tests pass, no major framework rewrite, minimal dependency changes, and lockfile consistency.
data-migration-with-oops | 4 | schema migration + reversal | Fixture repo is a Rails or Django CRM app with customers, orders, and an API. Message 1 asks to add stored `customer_status` with migration, API field, admin filter, and tests. Message 2 says "oops, status should be derived from orders and chargebacks, not stored". Message 3 asks to preserve API compatibility for clients expecting `customer_status`. Message 4 asks for migration rollback safety and docs. Final oracle checks derived semantics, no stale stored status source, compatible API output, rollback-safe migration, and tests/docs.
large-codebase-wrong-module-trap | 3 | navigation | Fixture repo has two similarly named packages, `billing-reports` and legacy `billing_reporter`, but only `billing-reports` is used by the CLI. Message 1 reports that `billing report --format csv` drops zero-dollar invoices and mentions the legacy package name from an old runbook. Message 2 asks why the first obvious patch did not affect the CLI if the agent touches the wrong module. Message 3 asks for the final fix and regression test through the real CLI entrypoint. Final oracle checks execution tracing, correct package edited, legacy code untouched unless justified, and CLI-level test coverage.
