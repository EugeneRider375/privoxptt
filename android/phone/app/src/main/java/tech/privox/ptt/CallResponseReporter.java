package tech.privox.ptt;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class CallResponseReporter {
    private CallResponseReporter() {}

    static void report(String responseUrl, String callId, String responseToken, String status) {
        if (empty(responseUrl) || empty(callId) || empty(responseToken)) return;
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(responseUrl).openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(5_000);
                connection.setReadTimeout(5_000);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");

                JSONObject body = new JSONObject();
                body.put("callId", callId);
                body.put("responseToken", responseToken);
                body.put("status", status);
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(bytes);
                }
                connection.getResponseCode();
            } catch (Exception ignored) {
                // The server timeout remains the fallback if the network is unavailable.
            } finally {
                if (connection != null) connection.disconnect();
            }
        }, "PrivoxCallResponse").start();
    }

    private static boolean empty(String value) {
        return value == null || value.isEmpty();
    }
}

