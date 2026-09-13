# Attendance Kiosk UI v2

The kiosk home experience is designed for fast shared-device use in a school entrance or attendance point.

## Visual hierarchy

- Dark Ledgerly kiosk shell with a high-contrast live connectivity header.
- Large welcome hero with roster counts and pending-sync visibility.
- Prominent Arriving / Leaving segmented control.
- Fast Face / QR camera card and always-on NFC readiness card.
- Manual lookup as a secondary but accessible fallback.
- Large identity confirmation card and full-screen attendance success acknowledgement.

## Interaction principles

- Face, QR, NFC and supervised manual attendance remain available.
- Offline captures continue to queue and sync through the existing attendance pipeline.
- The administrator exit gesture and PIN remain unchanged.
- The 10-second idle live display and employee PIN lock are owned by `KioskExperienceScreen` and remain intact.
- Test-mode attendance remains visibly marked and non-official.
