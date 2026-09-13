# Attendance kiosk live display

Ledgerly Attendance kiosk mode now includes an idle live-school display.

## Behaviour

- Android lock-task kiosk mode is reapplied whenever the app returns to the foreground.
- The device display is kept awake while kiosk mode is active.
- After **10 seconds** without touch, the kiosk transitions to the live display.
- Any touch immediately returns to the attendance kiosk and restarts the idle timer.
- Live panels rotate every **6 seconds** and refresh data every **20 seconds**.
- The display continues with the latest cached roster/activity state when the server is unavailable.

## Panels

1. Student attendance — present, not marked in, roster size and percentage.
2. Teachers & staff — present, not marked in, staff roster and percentage.
3. Attendance flow — check-ins, check-outs, captures, last activity and sync health.
4. Class/department pulse — top roster groups and their current presence from this kiosk.

The current device API exposes the roster but does not expose a school-wide multi-kiosk presence aggregate. For that reason, presence metrics are intentionally labelled **THIS KIOSK TODAY**. Ledgerly does not fabricate school-wide figures. The live display can later consume a server-wide aggregate without changing its presentation contract.

## Persistence and offline behaviour

Official attendance events still use the existing durable offline queue. In addition, the kiosk maintains a small daily presence state in secure local storage for the display. Test-mode face captures are excluded. The state rolls over automatically on a new local calendar day.

## Settings

Defaults live in `src/kioskDisplaySettings.ts` and are persisted in the existing secure `OfflineStore`:

- `kioskEnabled: true`
- `liveDisplayEnabled: true`
- `idleTimeoutMs: 10000`
- `refreshIntervalMs: 20000`
- `panelIntervalMs: 6000`

Timeouts are clamped to safe ranges when settings are loaded.

## Exit safeguards

The existing kiosk administrator flow is unchanged. Exiting lock task or changing the device purpose continues to require the configured administrator PIN through `DeviceManager.verifyExitPin`.
