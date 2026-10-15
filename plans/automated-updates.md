# Automated update checks and user-controlled updates

## Agreed behavior

Support Windows, macOS, and Linux. Check in the background after launch and every
24 hours while the app remains open. Settings provides an automatic-check toggle
(enabled by default) and a manual **Check for updates** button. Use published,
stable GitHub Releases from `caseycrocamo/silhouette-card-maker`; exclude drafts
and prereleases, and do not offer downgrades.

Windows installer builds and Linux AppImage builds offer in-app downloads followed
by **Restart and install**. macOS initially offers **Download update**, opening the
release page, until Apple signing and notarization are configured. Downloads and
installation always require user action.

## Existing application constraints

`GUI/package.json` currently declares app version `1.1.0`, Electron 27, and
electron-builder 24. Windows produces NSIS and ZIP artifacts; macOS produces DMG
and ZIP artifacts with signing disabled; Linux produces AppImage and tar.gz
artifacts. No updater dependency, publish configuration, or application-release
workflow exists yet.

`GUI/main.js` starts a persistent Python PDF worker. Its current shutdown helper
rejects pending jobs and can kill the worker after a grace period, so invoking
that helper during active PDF generation is not a safe update policy. Other
subprocess work, including text-to-PDF conversion, also needs protection.

Packaged images, decklists, outputs, and calibration data already resolve under
Electron's user-data directory through `GUI/shared/constants.js`. Preserve the
existing application identity and these paths across upgrades.

## 1. Release and package foundation

Add `electron-updater` as a runtime dependency. Select and lock a compatible
Electron, builder, updater, and Node combination before implementation; validate
the installed versions' APIs rather than copying configuration from unreleased
documentation. Any necessary runtime upgrade needs its own regression checks.

Configure the GitHub publish provider explicitly with owner `caseycrocamo` and
repository `silhouette-card-maker`, so the upstream remote cannot become the
update feed accidentally. Use the GUI package version as the authoritative app
version and require matching `v<version>` release tags.

Keep native build jobs for each supported OS and architecture. Include the Python
executables and calibration resources in every application update; never download
or replace Python executables independently. Define which architectures are
actually supported, starting with the existing Windows x64 target. Advertise an
update only when the matching artifact exists.

Add a release workflow that builds and tests each supported target, uploads
artifacts to a draft release, and publishes only after all required outputs have
been verified. Upload builder-generated update metadata (`latest.yml` and
`latest-linux.yml`, including architecture-specific variants where applicable),
checksums, and blockmaps alongside their referenced artifacts. Do not expose a
partially uploaded release. Keep release credentials in CI secrets; clients need
no embedded GitHub token for a public feed.

## 2. Main-process update service

Create `GUI/Utilities/updateService.js` to own scheduling, preferences, discovery,
download state, and installation. Initialize it after the first window opens so
startup never waits on the network. Disable production checks and installation in
development; exercise the UI through a mock provider or explicit test feed.

For supported installed builds, use `electron-updater` and its generated feed
configuration. Disable automatic download and automatic installation on ordinary
quit using the selected dependency version's supported controls. Call download
and installation methods only in response to validated user commands.

For macOS and archive distributions that cannot update in place, use GitHub's
stable release API for discovery, normalize a leading `v`, and compare versions
with a SemVer library. Windows ZIP and Linux tar.gz installations receive the
same manual-download fallback. Detect the installed distribution explicitly where
necessary; OS alone is insufficient to select an updater. Unsupported or
read-only installations must show a useful fallback instead of attempting file
replacement.

Represent service state as `idle`, `checking`, `up-to-date`, `available`,
`downloading`, `ready-to-install`, `installing`, or `error`. Include installed and
available versions, last successful check time, release details, download
progress, update capability, and a safe error message. Keep this state in the
main process so page navigation or additional windows cannot reset a download or
start duplicate operations.

Use a single in-flight operation guard. Schedule the first check shortly after
launch and subsequent checks every 24 hours while running; coalesce overdue
checks after sleep into one request. Manual checks bypass the schedule, but join
an existing check instead of duplicating it. Toggling automatic checks off removes
the timer and prevents future automatic requests, while manual checks still work.

Persist preferences and reminder state atomically in an update-specific JSON file
under `app.getPath('userData')`, separate from printer calibration. Missing or
invalid preferences recover to defaults. Bound network requests, honor rate-limit
and retry headers, and use bounded backoff after failures. Offline failures do
not block normal work or produce repeated dialogs. A failed check must never be
reported as “up to date.”

## 3. Settings and notification flow

Add an **Application updates** section to `GUI/Settings/settings.html` and
`settings.js`, displaying the installed version, last check, automatic-check
toggle, manual-check button, and current status.

Expose narrow IPC commands for reading state, changing preferences, checking,
downloading, installing, and opening the approved release page. Validate callers
and payloads in the main process. Render release notes as plain text or sanitized
content; do not accept arbitrary renderer-provided feed or executable URLs.

Show a nonblocking update banner through a shared component available across GUI
pages. Query current state when a page loads and subscribe to changes without
accumulating duplicate listeners.

The user flow is:

1. A background check finds a newer compatible stable release.
2. Show its version and release notes with **Download update** and **Later**.
   A manual fallback identifies that installation happens outside the app.
3. On Windows NSIS or Linux AppImage, download only after the user chooses it;
   show progress and allow the user to continue working. Offer cancellation where
   supported and retry after failures.
4. Once verified, show **Restart and install** and **Later**. Download completion
   alone must never restart the app. Verify ordinary-quit behavior on each target.
5. **Later** suppresses repeated banners for the same version for 24 hours while
   leaving the update available in Settings. A newer version can notify again.

Quiet background checks do not announce that the app is current. Manual checks
show explicit results, including offline, missing metadata, or unsupported-target
messages. Missing metadata is a release error, with a manual release-page option.

## 4. Installation and data preservation

Track active and queued jobs in the main process across PDF creation, offsets,
and other subprocess tasks. Before installing, stop accepting new jobs, wait for
existing work to finish, and recheck that the queue is empty. Do not force-kill
active work. If a job fails or does not finish, keep installation deferred and
let the user resolve the job.

Before the final restart, warn about any unsaved form state and allow the user to
cancel, or preserve that state for restoration. Then gracefully stop the idle
worker and wait for its exit before asking the updater to quit and install.
Disable duplicate restart actions and prevent new jobs during this transition.

Retain updater checksum validation and signature verification wherever signing
is configured. The current Windows build is unsigned: do not claim publisher
verification until signing is enabled. A checksum mismatch must abort the update.
Use HTTPS and only the configured release source. Keep downloaded installers in
the updater cache, never in game-data directories.

Preserve `appId`, application naming, user-data paths, images, decklists, PDFs,
and `offset_data.json`. Avoid destructive migrations; back up data before any
future schema migration. If an update fails, show recovery instructions and a
manual release link. Do not promise automatic rollback: test recovery using the
previous installer and ship fixes as a newer version.

## 5. macOS fallback and later in-app support

Initially, automatically discover updates and open the validated GitHub release
page for manual DMG/ZIP installation. Explain that the user should finish current
work and quit the app before replacing it. Existing user data remains separate
from the application bundle.

When Apple signing is available, configure Developer ID signing and notarization
for the app and bundled native executables, retain DMG and ZIP outputs, and
publish `latest-mac.yml`. Test the exact download, staging, quit, and relaunch
behavior before enabling the in-app flow. Keep manual fallback available for
older unsigned installations and unsupported locations or architectures.

## 6. Validation and rollout

Test version comparison, draft/prerelease exclusion, architecture selection,
automatic-check preferences, scheduling after sleep, concurrent commands,
reminder persistence, offline/rate-limit handling, and invalid preferences.
Mock the updater boundary for deterministic service and UI tests.

Perform real packaged upgrades from version N to N+1 on Windows NSIS and Linux
AppImage using an isolated test feed. Verify checksum failure, failed download,
read-only destinations, installation failure recovery, ordinary quit after
choosing Later, and a restart attempted while PDF work is active. Verify images,
decklists, offsets, and generated PDFs survive. Test macOS, Windows ZIP, and Linux
tar.gz discovery and manual-download flows separately. Run the existing Node and
Python compatibility checks on release builds.

The first release containing this feature must be installed manually by existing
users because earlier releases have no updater. Document that bootstrap step,
the supported package formats, and the macOS fallback in `GUI/README.md` and
release notes. Before publishing the first update to updater-enabled users,
validate the complete N-to-N+1 path and all release metadata in CI.

Delivery order: establish release artifacts and metadata; implement the service
and Settings controls; add download and safe restart behavior; validate packaged
upgrades and document the bootstrap release. Track implementation work in beads
when implementation begins; this document specifies the design.

## Reference documentation

- [electron-builder stable auto-update guide](https://www.electron.build/v26/docs/features/auto-update/)
- [electron-builder stable publishing configuration](https://www.electron.build/v26/docs/publish/)

The project currently uses builder 24. These stable builder 26 references describe
the intended approach, not a declaration that the current dependency set already
supports every option. Confirm API and metadata compatibility for the versions
selected during implementation.
