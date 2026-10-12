# Push notifications

A phone gets a notification for a new message even when the app is closed. Release builds do this with no setup: the server sends each notification through a relay we run in our Firebase project, and Firebase delivers it to the iPhone (through Apple) or to Android.

## How it works

1. When a phone signs in, it gets a push token from Firebase and makes a random key. It gives both to its own server over the server's normal, authenticated connection.
2. The server registers the token with the relay, which checks it with Firebase and answers a ticket that lets that server send to that phone and no other.
3. When a message arrives, the server encrypts the notification (who it is from, the text, which conversation) with the phone's key and hands the relay only the token, the ticket and the encrypted bytes.
4. The relay passes them to Firebase. The phone opens the notification with its key and shows it; tapping it opens the conversation.

The relay never sees what a notification says, who it is from or which conversation it belongs to. Neither does Firebase, Apple or Google: they carry encrypted bytes and a placeholder ("New message") that the phone replaces.

## What the relay holds

The relay is a function in our Firebase project. It reaches Firebase as the project's own service account, so no Firebase key file exists, not in a build, a server or this repository. The only secret it holds is the one that signs tickets, kept in the project's Secret Manager. Its code is `relay/`, and its tests are `relay/test/`.

## Limits

- A server can send only to phones it registered through the relay.
- Each phone can receive at most 30 notifications a minute, and each address can register at most 10 phones a minute.
- At most two copies of the relay run at once.

## Fair use, and when we turn it off

The relay is a free service we run for anyone using a release build. **If it is abused, we will block the abusers, change how it works, or switch it off for everyone, without notice.** Switching it off stops push notifications on every release build; the apps keep working and still show notifications while they are open. Anyone who needs push that does not depend on us can run their own relay, below.

## Running your own

You need your own relay when you build the iPhone app under your own Apple team (Apple delivers a push only to an app signed by the team that owns the push key), when you change the Android application id, or when you would rather not depend on ours.

1. Create a Firebase project, add an iPhone app and an Android app with your bundle and application ids, and upload your Apple push key under Project settings, Cloud Messaging.
2. Put the project's `GoogleService-Info.plist` and `google-services.json` in your builds in place of ours.
3. Create the ticket secret and deploy the relay from this repository: `firebase functions:secrets:set RELAY_TICKET_SECRET`, then `firebase deploy --only functions:relay --project <your project>`. The project needs the Blaze plan.
4. Point your server at it: `node server/src/main.js config set push.relay <the relay's URL>`.
