import Foundation
import Capacitor

/// Universal Link (applinks:ptt.privox.tech) уже долетает до приложения —
/// подтверждено живьём 26.08.2026 (открывает WebView, не Safari). Но дальше
/// событие некому подхватить: официальный @capacitor/app в проекте не
/// подключён, а без него URL, которым открыли приложение, нигде не
/// сохраняется — WebView просто остаётся на том экране, что был (обычно
/// /login), полностью игнорируя /join/<токен> из ссылки.
///
/// Вместо official-плагина (потребовал бы правки управляемого Capacitor CLI
/// файла CapApp-SPM/Package.swift — рискованно трогать руками) — свой
/// плагин по тому же паттерну, что уже используется для PrivoxPush: нативная
/// сторона (SceneDelegate.swift) ловит URL и шлёт NotificationCenter,
/// плагин пересылает в JS через notifyListeners.
@objc(PrivoxDeepLinkPlugin)
public class PrivoxDeepLinkPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PrivoxDeepLinkPlugin"
    public let jsName = "PrivoxDeepLink"
    public let pluginMethods: [CAPPluginMethod] = []

    public override func load() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleNotification(_:)),
            name: .privoxDeepLinkOpened, object: nil
        )
    }

    @objc private func handleNotification(_ notification: Notification) {
        guard let url = notification.userInfo?["url"] as? String else { return }
        print("[Privox] PrivoxDeepLinkPlugin forwarding deepLinkOpened to JS, url=\(url)")
        notifyListeners("deepLinkOpened", data: ["url": url])
    }
}

extension Notification.Name {
    static let privoxDeepLinkOpened = Notification.Name("privoxDeepLinkOpened")
}
