package com.azuretek.cuate

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Receives each sealed push (issue 347, docs/PUSH.md). The relay sends Android a data-only message at high priority,
 * so this runs whether the app is open or not; it opens the notification with the phone's key and shows the sender and
 * the text, and a press opens the conversation the way a message notice does (issue 331). A notification it cannot
 * open is shown as a plain one rather than dropped.
 */
class PushService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        if (data["probe"] == "1") return
        val sealed = data["sealed"] ?: return
        val notice = Push.open(sealed, SecureStore(this).get(Push.KEY_ACCOUNT))
        show(this, notice)
    }

    /** A new token reaches the server the next time the app is opened, when the page registers again. */
    override fun onNewToken(token: String) {}

    companion object {
        fun show(context: Context, notice: Push.Notice?) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
            manager.createNotificationChannel(NotificationChannel(HostBridge.CHANNEL_ID, Naming.product(context.assets).ifEmpty { "Messages" }, NotificationManager.IMPORTANCE_DEFAULT))
            val builder = android.app.Notification.Builder(context, HostBridge.CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(notice?.title ?: "New message")
                .setContentText(notice?.body ?: "")
                .setAutoCancel(true)
            val chat = notice?.chatId?.take(200).orEmpty()
            val open = Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            if (chat.isNotEmpty()) {
                open.setAction("cuate.notice.open")
                    .putExtra(HostBridge.EXTRA_CHAT, chat)
                    .putExtra(HostBridge.EXTRA_MESSAGE, notice?.messageId?.take(200).orEmpty())
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            builder.setContentIntent(PendingIntent.getActivity(context, chat.hashCode(), open, flags))
            // One notice per conversation, the same id the app's own notices use, so a newer message replaces it.
            manager.notify(if (chat.isNotEmpty()) chat.hashCode() else "push".hashCode(), builder.build())
        }
    }
}
