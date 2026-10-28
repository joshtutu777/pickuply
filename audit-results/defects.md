# Defects

No confirmed P0 or P1 product defect came out of the tests that actually ran.

## Not filed as product defects

- The local Next dev server stopped accepting connections during the Playwright run (`ERR_CONNECTION_REFUSED` and a hung `/privacy` and `/admin` navigation). The same pages respond on https://pickuplyapp.com. Retries did not change the local server behavior, so this was not turned into an application fix.
- Playwright could not launch until Chromium was installed in this environment. WebKit was not installed, so Safari-compatible browser coverage is not claimed.
- A second identical proof path raises a unique-key error and does not insert a second photo. The delivery test treats that as "no duplicate proof." The driver screen was not opened to see how that error is shown.

## Not implemented

- There is no separate support-administrator role. Roles are customer, driver, and admin.
- Support tickets in this audit did not include a file attachment.

No application code was changed. No pull request for a product fix is required from these results.
