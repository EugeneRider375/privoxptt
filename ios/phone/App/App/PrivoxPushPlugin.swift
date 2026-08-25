import Foundation
import UIKit
import CallKit
import Capacitor

/// Тот же контракт (имя плагина, методы, поля), что и Android PrivoxPushPlugin.java
/// — web/src/hooks/useNativePush.ts вызывает их одинаково на обеих платформах,
/// разница только в токене (voipToken вместо pushToken, см. useNativePush.ts).
@objc(PrivoxPushPlugin)
public class PrivoxPushPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PrivoxPushPlugin"
    public let jsName = "PrivoxPush"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumePendingCall", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearMessageNotifications", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endCall", returnType: CAPPluginReturnPromise),
    ]

    private static let tokenWaitStepMs = 200
    private static let tokenWaitMaxSteps = 15 // ~3с — PKPushRegistry обычно успевает раньше

    // Слушаем "завершили с нативного экрана CallKit" (см. AppDelegate,
    // CXEndCallAction) и пересылаем в JS — иначе ActiveCallScreen никогда не
    // узнает, что разговор закончен, и повиснет с открытым WebRTC-каналом.
    public override func load() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleCallEndedNatively(_:)),
            name: .privoxCallEndedNatively, object: nil
        )
    }

    @objc private func handleCallEndedNatively(_ notification: Notification) {
        guard let callId = notification.userInfo?["callId"] as? String else { return }
        print("[Privox] PrivoxPushPlugin forwarding callEndedNatively to JS, callId=\(callId)")
        notifyListeners("callEndedNatively", data: ["callId": callId])
    }

    // Обратное направление: кнопку HANG UP нажали ВНУТРИ приложения — нужно
    // сказать об этом CallKit, иначе системный экран звонка (и зелёная
    // "трубка" в статус-баре) останутся висеть, будто разговор продолжается.
    @objc func endCall(_ call: CAPPluginCall) {
        print("[Privox] PrivoxPushPlugin.endCall called from JS, callId=\(call.getString("callId") ?? "nil")")
        guard let callIdString = call.getString("callId"), let uuid = UUID(uuidString: callIdString) else {
            call.reject("callId is required")
            return
        }
        // Capacitor вызывает методы плагина на своей bridge-очереди, а не на
        // главном потоке — UIApplication.shared.delegate (как и CXCallController.
        // request) обязаны идти на главном, иначе Main Thread Checker ругается
        // (см. живой лог 25.08.2026: "UI API called on a background thread").
        DispatchQueue.main.async {
            guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else {
                call.reject("AppDelegate unavailable")
                return
            }
            let transaction = CXTransaction(action: CXEndCallAction(call: uuid))
            appDelegate.callController.request(transaction) { error in
                if let error {
                    print("[Privox] endCall request failed: \(error)")
                    call.reject("Failed to end call: \(error.localizedDescription)")
                } else {
                    call.resolve()
                }
            }
        }
    }

    @objc func getToken(_ call: CAPPluginCall) {
        print("[Privox] PrivoxPushPlugin.getToken called from JS")
        pollForToken(attemptsLeft: Self.tokenWaitMaxSteps, call: call)
    }

    private func pollForToken(attemptsLeft: Int, call: CAPPluginCall) {
        if let token = PendingCallStore.voipToken() {
            print("[Privox] getToken resolving with token (\(attemptsLeft) attempts left)")
            call.resolve(["token": token])
            return
        }
        guard attemptsLeft > 0 else {
            print("[Privox] getToken giving up — no VoIP token available after wait window")
            call.reject("VoIP token not available yet")
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(Self.tokenWaitStepMs)) {
            self.pollForToken(attemptsLeft: attemptsLeft - 1, call: call)
        }
    }

    @objc func consumePendingCall(_ call: CAPPluginCall) {
        guard let pending = PendingCallStore.consume() else {
            call.resolve([:])
            return
        }
        call.resolve([
            "callId": pending.callId,
            "fromUserId": pending.fromUserId,
            "fromCallsign": pending.fromCallsign,
            "fromDisplayName": pending.fromDisplayName,
            "groupId": pending.groupId,
            "groupName": pending.groupName,
            "responseStatus": pending.responseStatus,
            "kind": pending.kind,
        ])
    }

    // На iOS входящий звонок не оставляет отдельного уведомления, как на
    // Android (это нативный CallKit-экран, а не NotificationManager) —
    // чистить нечего, но метод должен существовать, чтобы общий web-код
    // не падал при вызове на этой платформе.
    @objc func clearMessageNotifications(_ call: CAPPluginCall) {
        call.resolve()
    }
}
