# Attendance Kiosk UI v2

The kiosk home experience is designed for fast shared-device use in a school entrance or attendance point.

## Visual hierarchy

- Dark Ledgerly kiosk shell with a high-contrast live connectivity header.
- Large welcome hero with roster, student, staff and pending-sync visibility.
- Prominent Arriving / Leaving segmented control.
- Large name search field with fast matching against names, admission numbers and staff numbers.
- Clear identity confirmation card before an attendance event is recorded.
- Large full-screen attendance success acknowledgement.

## Interaction principles

- The kiosk uses **name lookup only** for attendance capture.
- Face recognition, QR scanning and NFC attendance capture are not part of the kiosk workflow.
- Selecting a person records attendance through the existing supervised `MANUAL` event path so offline queueing, audit and sync behavior remain compatible.
- Offline captures continue to queue and sync through the existing attendance pipeline.
- The administrator exit gesture and PIN remain unchanged.
- The 10-second idle live display and employee PIN lock are owned by `KioskExperienceScreen` and remain intact.
