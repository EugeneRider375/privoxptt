# PRIVOX PTT Documentation

## User guides

- [Android smartphone guide (Russian)](PHONE_ANDROID_GUIDE_RU.md)
- [iPhone web guide (Russian)](IPHONE_WEB_GUIDE_RU.md)
- [Desktop web guide (Russian)](WEB_DESKTOP_GUIDE_RU.md)
- [Inrico T320 guide (Russian)](RADIO_T320_GUIDE_RU.md)
- [Inrico T320 guide (English)](RADIO_T320_GUIDE_EN.md)
- [Messenger guide (Russian)](MESSENGER_RU.md)

## Technical documentation

- [FCM wake calls and presence states](FCM_WAKE_CALLS_RU.md)
- [Test report — 2026-06-06](TEST_REPORT_2026-06-06.md)
- [Android phone and T320 builds](../android/README.md)
- [Server](../server/README.md)

## Current Android release

- Phone APK: `1.9` (`versionCode 10`) — signed
- Inrico T320 APK: `1.8` (`versionCode 9`) — signed, autostart + incoming calls
- Package: `tech.privox.ptt`
- Signed with the production PRIVOX key (kept outside the repository).
  Upgrading from an earlier test build requires uninstalling it first —
  Android will not install over a different signature.

Phone and T320 APKs are different builds. Always install the APK from the
matching project directory.
