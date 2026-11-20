# Changelog for the next release

> [!IMPORTANT]
> This release comes with some breaking changes for self-hoster. Please read carefully.

## New features

### AI fitness assistant (AI 健身助手)
A chat assistant powered by the DeepSeek API (`deepseek-flash`, thinking mode
off for fast replies) answers fat-loss, training and nutrition questions in
Chinese at `/ai-assistant/`, reachable from the sidebar. Bring-your-own-key:
each user pastes their own DeepSeek API key into the page's key panel; it is
kept only in that browser's localStorage and sent per request via the
`X-DeepSeek-Key` header to a Django proxy that relays the streaming SSE
response, so the server never stores personal keys. A server-wide
`DEEPSEEK_API_KEY` (env var or the gitignored `settings/local_dev_extra.py`)
acts as a shared fallback. The user's daily calorie goal is passed as personal
context; without any key the page guides the user to set one.

### Landing page visual polish (tiger-减脂)
The black/starfield/tiger landing page gains an additive layer of motion and
depth without changing its structure: scroll-reveal on the hero, feature
sections and FAQ, a glassmorphism stat band with animated counters (real local
counts: exercises, exercise photos, interface languages, free/open-source), a
warm glow behind the hero tiger, tiger-orange gradient headings, 3D tilt on the
hero image, button shine sweep, card lift and an accent scrollbar/focus ring.
Three MIT libraries are vendored under `core/static/vendor/` (AOS, countUp.js,
vanilla-tilt.js) and wired by `core/static/js/tiger-fx.js`; all motion respects
`prefers-reduced-motion` and degrades gracefully when a library is absent.

### Landing page motion, round 2 (tiger-减脂)
A second additive pass on the same black/starfield/tiger base: a typewriter
line under the hero headline cycles Chinese slogans (typewriter-effect, MIT),
the hero tiger column gets gentle scroll parallax (rellax, MIT), and buttons
site-wide gain a material ripple (Waves, MIT). All three are vendored under
`core/static/vendor/` with their licenses and wired by `tiger-fx.js`; each is
feature-detected and skipped under `prefers-reduced-motion` (parallax/tilt also
skip touch devices), and the typewriter line keeps a static fallback when JS
is unavailable.

### Deep-space background, round 3 (tiger-减脂)
The black base gains two additive, very dark background layers beneath the
existing starfield and tiger watermark: a slow drifting radial nebula gradient
(granim.js, MIT) cycling deep ember / teal / maroon tints, and a sparse field of
floating tiger-orange embers (particles.js, MIT) that gently repulse from the
cursor. Layer order is nebula < embers < starfield < watermark < content, and
both layers stay low-opacity so text legibility and the black theme are
preserved. Vendored under `core/static/vendor/`, wired by `tiger-fx.js`, and
skipped entirely under `prefers-reduced-motion`.

### Food photo scan (拍照识餐)
Upload a food photo and a local Food-101 ConvNeXt-Tiny ONNX model recognizes the
dish and estimates its calories, without sending the image to any external
service. The result is confirmed against the top-5 candidates and a portion size,
then written to the nutrition diary as a `LogItem` (creating the ingredient and a
logging-only plan on first use). The page also shows today's intake against the
daily calorie goal and gives concrete next-meal suggestions sized to the remaining
energy budget. Reachable at `/nutrition/food-scan/` and from the sidebar.

### Double progression
Progression requirements can now reference the top of the prescribed range via the new rules `max_repetitions` and `max_weight`, and the new `all_sets` flag requires every prescribed set to qualify. Together they enable classic double progression schemes ("work from 8 to 12 reps at a fixed weight, add weight only once all sets reach 12"), e.g. `{"rules": ["max_repetitions"], "all_sets": true}`.

### Others
* `/api/v2/measurement/` accepts a `metric_type` instead of a `category` id when
  writing, and can be filtered by `metric_type` and `external_id`. Integrations
  such as scale apps no longer have to look up their category first or keep
  track of the ids of the entries they wrote.
* Exercise contributions always have an author: if none is given, the username
  is used. Everyone who edits an exercise or translation is credited as an
  author, images and videos keep the author of the file.
* The routine date sequences (`date-sequence-gym`, `date-sequence-display`) have
  a new `text_repr_short` per set: repetitions and weight only, without sets,
  RiR and rest, e.g. for notifications.
* Measurements have a new generic `device` source for data written by a wearable
  or sensor app on behalf of the user. Put vendor and model in `extra_data`. It
  is deduplicated on `external_id` and checked against the metric limits like
  every other source.
* Workout logs have an optional `notes` field, so individual sets can get a note
  (e.g. form cues or how the set felt) in addition to the notes of the session.
* Cloudflare Turnstile can be used as captcha on the registration and password
  reset forms, as an alternative to Google reCAPTCHA. The `CAPTCHA_PROVIDER`
  setting selects reCAPTCHA, Turnstile or no captcha, see the settings page in
  the docs.

### Bug fixes

* All 1RM estimates (calculated "1RM" and "1RM total" measurements, personal
  record trophies, routine statistics) now share one calculation. The reps in
  reserve of a set now also raise the estimate of the calculated measurements,
  existing curves change accordingly on their next recalculation. Personal
  records compare sets logged in lb and kg correctly and are no longer awarded
  for sets not counted in repetitions or not weighed in kg or lb. Personal
  record trophies already awarded for such sets are deleted by a migration.
* Counted messages for token expiry, confirmation links, inactive-member reminders,
  and workout-session limits now use locale-aware plural forms.
* Deleting a routine, day, slot, or slot entry now preserves completed workout
  sessions and logs, including performed and target values. Only the references
  to deleted routine structure are cleared. Explicit session deletion and account
  deletion continue to remove the corresponding history. Apply the usual database
  migrations when upgrading; previously deleted history cannot be restored by
  this change.
* Sets with "Until Failure" or "Max Reps" but no repetitions value keep their
  unit in the routine API and show it in the set text.
* The exercise and ingredient syncs no longer hang forever when the remote
  server stops answering. Requests to it now time out, see
  `WGER_REQUEST_TIMEOUT`.
* Gallery and exercise images with more than about 89 megapixels are now
  rejected on upload.
* `wger load-online-fixtures` downloads the ingredient fixture from
  `https://wger.de/media/ingredients/` instead of GitHub. A failed download now
  stops with an error instead of trying to load the error page.

## New settings
*(for self-hoster)*

* `CAPTCHA_PROVIDER` (`none`, `recaptcha` or `turnstile`) replaces `USE_RECAPTCHA`.
  `USE_RECAPTCHA=True` keeps working for now, but `manage.py check` warns about
  it. Turnstile needs `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`.
* `WGER_REQUEST_TIMEOUT` (default `60`): seconds to wait for an answer from a
  remote server, e.g. `WGER_INSTANCE` during the exercise and ingredient syncs,
  before giving up.
* `AWS_DEFAULT_ACL` (default empty): ACL for files uploaded to S3, e.g.
  `public-read` for buckets whose files aren't public by default.

## Breaking API changes
*(only relevant if you have your own scripts or interact with the REST API)*

* Creating exercises via `POST /api/v2/exercise/` now requires the `add_exercise`
  permission. Regular users should use `/api/v2/exercise-submission/`, which
  creates the exercise together with at least one translation.

## Upgrade steps

  ```bash
  docker compose pull 
  docker compose down powersync
  docker compose up -d web
  docker compose up -d powersync
  ```
