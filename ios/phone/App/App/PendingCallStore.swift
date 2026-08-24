import Foundation

/// Данные входящего звонка между получением VoIP-push и тем моментом, когда
/// WebView поднимется и заберёт их через PrivoxPushPlugin.consumePendingCall().
/// Зеркало Android SharedPreferences-хранилища в PrivoxPushPlugin.java —
/// те же ключи payload, тот же смысл responseStatus.
enum PendingCallStore {
    private static let defaults = UserDefaults.standard
    private static let prefix = "privox_pending_call_"
    private static let voipTokenKey = "privox_voip_token"
    private static let maxAgeSeconds: TimeInterval = 60

    struct Call {
        let callId: String
        let fromCallsign: String
        let fromDisplayName: String
        let groupId: String
        let groupName: String
        let responseUrl: String
        let responseToken: String
        let kind: String
        var responseStatus: String
    }

    static func save(callId: String, fromCallsign: String, fromDisplayName: String,
                      groupId: String, groupName: String, responseUrl: String,
                      responseToken: String, kind: String) {
        defaults.set(callId, forKey: prefix + "call_id")
        defaults.set(fromCallsign, forKey: prefix + "from_callsign")
        defaults.set(fromDisplayName, forKey: prefix + "from_display_name")
        defaults.set(groupId, forKey: prefix + "group_id")
        defaults.set(groupName, forKey: prefix + "group_name")
        defaults.set(responseUrl, forKey: prefix + "response_url")
        defaults.set(responseToken, forKey: prefix + "response_token")
        defaults.set(kind, forKey: prefix + "kind")
        defaults.removeObject(forKey: prefix + "response_status")
        defaults.set(Date().timeIntervalSince1970, forKey: prefix + "created_at")
    }

    static func setResponseStatus(_ status: String) {
        defaults.set(status, forKey: prefix + "response_status")
    }

    /// Читает и сразу очищает — ровно как consumePendingCall на Android:
    /// одноразовое потребление, повторный вызов вернёт пусто.
    static func consume() -> Call? {
        defer { clear() }

        guard let callId = defaults.string(forKey: prefix + "call_id") else { return nil }
        let createdAt = defaults.double(forKey: prefix + "created_at")
        guard Date().timeIntervalSince1970 - createdAt <= maxAgeSeconds else { return nil }

        return Call(
            callId: callId,
            fromCallsign: defaults.string(forKey: prefix + "from_callsign") ?? "",
            fromDisplayName: defaults.string(forKey: prefix + "from_display_name") ?? "",
            groupId: defaults.string(forKey: prefix + "group_id") ?? "",
            groupName: defaults.string(forKey: prefix + "group_name") ?? "",
            responseUrl: defaults.string(forKey: prefix + "response_url") ?? "",
            responseToken: defaults.string(forKey: prefix + "response_token") ?? "",
            kind: defaults.string(forKey: prefix + "kind") ?? "user",
            responseStatus: defaults.string(forKey: prefix + "response_status") ?? ""
        )
    }

    private static func clear() {
        for suffix in ["call_id", "from_callsign", "from_display_name", "group_id",
                       "group_name", "response_url", "response_token", "kind",
                       "response_status", "created_at"] {
            defaults.removeObject(forKey: prefix + suffix)
        }
    }

    static func setVoipToken(_ token: String?) {
        if let token { defaults.set(token, forKey: voipTokenKey) }
        else { defaults.removeObject(forKey: voipTokenKey) }
    }

    static func voipToken() -> String? {
        defaults.string(forKey: voipTokenKey)
    }
}
