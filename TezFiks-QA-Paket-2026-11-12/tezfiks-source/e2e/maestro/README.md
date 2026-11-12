# Android end-to-end flows (Maestro)

Device flows for the release APKs, run against whatever API the APKs were built for (the demo server by default).
They use the demo accounts from `docs/demo.md` (code `123456`).

| Flow | What it does |
|---|---|
| `customer-login.yaml` | Fresh install state, Azerbaijani UI, phone + code login (default Nizami, `PHONE=552000021`). Screenshots of the login screens. |
| `customer-screens.yaml` | Home, a category, orders, an order and its live tracking, wallet, profile (needs a logged-in customer). |
| `pro-login.yaml` | Same for TezFiks Usta (default Elvin, `PHONE=502000001`). |
| `pro-screens.yaml` | Home, orders, balance, profile (needs a logged-in handyman). |

Run one flow: `maestro test -e SIZE=standard e2e/maestro/customer-screens.yaml` (screenshots land in `~/.maestro/tests/<run>/`).

## Several phone screen sizes

`e2e/run-screen-sizes.sh <output-dir>` logs both apps in once, then changes the emulator's screen with
`adb shell wm size / wm density / settings put system font_scale` and runs the screen tours at each size:

| Name | Pixels | Density | Font scale | Roughly |
|---|---|---|---|---|
| small | 720 x 1280 | 320 | 1.0 | 360 x 640 dp, budget phone |
| standard | 1080 x 2400 | 420 | 1.0 | Pixel-size phone |
| large-font | 1080 x 2400 | 420 | 1.3 | accessibility font size |
| tall-hd | 1440 x 3120 | 560 | 1.0 | large high-density phone |
| short-wide | 1080 x 1920 | 420 | 1.0 | 16:9 phone |

The screenshots are copied to `<output-dir>/<size>/`. The script resets the emulator's screen at the end.
