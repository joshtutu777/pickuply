# Twilio campaign notes

These pages are prepared in the app. They are not live on pickuplyapp.com until this branch is deployed.

Intended public URLs:

- https://pickuplyapp.com/signup — redirects to phone sign-up at `/login`
- https://pickuplyapp.com/driver/apply — redirects to phone sign-up with driver intent
- https://pickuplyapp.com/privacy
- https://pickuplyapp.com/terms

## Use case

Pickuply sends a one-time sign-in code when someone asks for one. That code is separate from optional notifications.

Optional texts, only after the person checks the box:

- Customers: requests, driver offers, bookings, and deliveries
- Drivers: application status, available jobs, offers, and assignments

Available-job texts are optional. They are not required to apply or to accept a job.

## Opt-in

The checkbox starts unchecked. The account or application can be finished with it unchecked. Terms acceptance on the name screen is a different checkbox.

The consent row stores the profile, the time, the disclosure version `2026-10-23`, and the source `login` or `driver_onboarding`. That also turns on optional SMS for that person. The platform switch `sms_enabled` must still be on before any optional text is sent.

## STOP and HELP

Inbound texts go to `POST /api/twilio/sms`. Twilio must sign the request with the account token. STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, and QUIT call `record_sms_opt_out` and turn optional texts off. HELP replies with the opt-out instruction and info@pickuplyapp.com. The sign-in code is not sent by this route.

## Example messages

Customer: "New offer. A driver offered on your request. Open Pickuply to compare."

Driver: "Application update. Open Pickuply to see the next step."

Driver job alert, only with the driver checkbox: "A job is open near you. Open Pickuply to decide. Reply STOP to opt out."

## Not ready to resubmit

Do not tell Twilio these URLs are live until a production deploy is checked in a browser. The inbound webhook also needs `SUPABASE_SERVICE_ROLE_KEY` and `TWILIO_AUTH_TOKEN` on the server, and the Twilio phone number must point at `https://pickuplyapp.com/api/twilio/sms`.
