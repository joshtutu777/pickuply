# Defects

No confirmed P0 or P1 product defect came out of the tests that actually ran.

## Not filed as product defects

- The local Next dev server stopped accepting connections during the Playwright run (`ERR_CONNECTION_REFUSED` and a hung `/privacy` and `/admin` navigation). The same pages respond on https://pickuplyapp.com. Retries did not change the local server behavior, so this was not turned into an application fix.
- Playwright could not launch until Chromium was installed in this environment. WebKit was not installed, so Safari-compatible browser coverage is not claimed.
- A second identical proof path raises a unique-key error and does not insert a second photo. The delivery test treats that as "no duplicate proof." The driver screen was not opened to see how that error is shown.

## Not implemented

- There is no separate support-administrator role. Roles are customer, driver, and admin.
- Support tickets in this audit did not include a file attachment.

## Observed in the October 28 browser continuation

- The proof file control on the driver job page did not show a selected file after the test attached a PNG, and no `job_photos` row was written. The application did not show an error message. This is not filed as a product defect until a person can repeat it outside the automated file input. The authorized job was left uncaptured because of it.
- Driver home, after approval, still says "Finish these steps. Once we approve you, you can go Online" while the database status is already `active`. Insurance and training remain on the checklist. The Online switch worked without an insurance card. Help text that says insurance is required before Online does not match this screen.
- The dev server restarted or exited when its heap reached the Node limit. `experimental.devMemoryThresholdRestart` was set to false so a near-limit restart does not drop the local server mid-test. Production is unchanged by that setting.

No live charge, transfer, or bank payout was created.
