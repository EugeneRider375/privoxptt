import Foundation
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
    ]

    private static let tokenWaitStepMs = 200
    private static let tokenWaitMaxSteps = 15 // ~3с — PKPushRegistry обычно успевает раньше

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
