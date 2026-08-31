import UIKit
import Capacitor
import UserNotifications

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    // ⚠️ Приложение сценовое (UIWindowSceneDelegate) — AppDelegate.
    // applicationDidBecomeActive у таких приложений НЕ вызывается вообще,
    // Apple перенесла этот момент сюда. Найдено 2026-08-31 живым тестом:
    // сброс бейджа в AppDelegate.applicationDidBecomeActive был написан
    // дважды (сначала старым API, потом новым setBadgeCount) и оба раза не
    // срабатывал на реальном iPhone — не из-за самого API, а потому что
    // метод в AppDelegate попросту никогда не вызывался.
    func sceneDidBecomeActive(_ scene: UIScene) {
        if #available(iOS 17.0, *) {
            UNUserNotificationCenter.current().setBadgeCount(0) { error in
                if let error { print("[Privox] setBadgeCount failed: \(error)") }
            }
        } else {
            UIApplication.shared.applicationIconBadgeNumber = 0
        }
    }

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        // Не голый CAPBridgeViewController — MainViewController регистрирует
        // PrivoxPushPlugin через capacitorDidLoad(), иначе useNativePush.ts
        // на веб-стороне не находит плагин и звонок никогда не доходит до
        // iPhone в фоне (см. MainViewController.swift).
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        // Universal Link (открытие /join/<токен> и т.п.) приходит именно
        // сюда — webpageURL и есть та самая ссылка, по которой открыли
        // приложение. См. PrivoxDeepLinkPlugin.swift за тем, что происходит
        // дальше (без него WebView просто остаётся на дефолтном экране).
        if userActivity.activityType == NSUserActivityTypeBrowsingWeb,
           let url = userActivity.webpageURL {
            print("[Privox] Universal Link opened: \(url.absoluteString)")
            NotificationCenter.default.post(
                name: .privoxDeepLinkOpened, object: nil,
                userInfo: ["url": url.absoluteString]
            )
        }
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
