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
- Tapping the Ledgerly logo five times opens the kiosk escape lock screen.
- The kiosk escape PIN is hard-coded to `1212` as requested for this deployment.
- A valid escape PIN calls the native kiosk exit only; it does not change device purpose, clear enrollment or log an employee in.
- Leaving kiosk mode is temporary. When Ledgerly becomes active again, the app automatically calls `KioskManager.enter()` and restores lock-task / immersive kiosk mode.
- The 10-second idle live display and employee PIN lock are owned by `KioskExperienceScreen` and remain intact.
