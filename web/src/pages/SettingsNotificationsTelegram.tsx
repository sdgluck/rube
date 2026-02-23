import NotificationServiceForm from "./NotificationServiceForm";

export default function SettingsNotificationsTelegram() {
  return (
    <NotificationServiceForm
      service="telegram"
      title="Telegram"
      fields={[
        {
          key: "global_telegram_bot_token",
          label: "Bot Token",
          type: "password",
          placeholder: "Enter Telegram bot token",
          hint: "Create a bot via @BotFather and copy the token",
        },
        {
          key: "global_telegram_chat_id",
          label: "Chat ID",
          placeholder: "Enter chat ID or group ID",
          hint: "Send a message to your bot, then visit api.telegram.org/bot<token>/getUpdates to find your chat ID",
        },
        {
          key: "global_telegram_send_silently",
          label: "Send silently (no notification sound)",
          type: "checkbox",
        },
      ]}
      eventsKey="global_telegram_events"
    />
  );
}
