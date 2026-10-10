# PeerSky Mobile Privacy Policy

Last updated: October 10, 2026

PeerSky Mobile is a web and peer-to-peer browser. There are no accounts, no
analytics and no servers of ours, so there is nowhere for us to collect anything
even if we wanted to. Nobody at P2P Labs can see what you browse, who you talk
to, or that you use the app at all.

This policy explains what the app handles, where it goes, and the parts that are
not perfect.

## What We Do See

The App Store and Google Play show us how many times PeerSky was downloaded, and
crash reports from people who agreed on their phone to share them with app
developers. Apple and Google collect these under their own privacy policies, and
neither tells us who you are.

## The QR Scanner

QR codes are read on your phone, and nothing about a scan is sent anywhere.

## Data Stored on Your Device

PeerSky stores browser settings, open tabs, history, bookmarks, download records, cached filter lists, and peer-to-peer application data on your device. None of it is sent to us.

Incognito tabs keep no history, page cache or tab previews, and their cookies and site data are gone once the last incognito tab closes. `hyper://` content opened in one is still stored by the app's peer-to-peer node, like any other drive, until you clear P2P data.

You can remove browsing and peer-to-peer data from the Data Clearing and P2P Data sections in Settings, and each site's cookies from Cookies and site data in Data Clearing. Files saved through the system download manager may also need to be removed through the Downloads screen or your device's file manager.

## Websites, Searches, and Peer-to-Peer Services

Websites you visit can receive standard network information, including your IP address, and may collect data under their own privacy policies. Searches typed into the address bar go to the engine chosen in Settings, or to the one you pick for a single search, and that engine's policy applies rather than this one. While you type a search, what you have typed so far also goes to that engine, without cookies, so it can suggest searches. Incognito tabs never send it, and neither does anything that looks like an address. You can turn off Search suggestions in Settings.

Opening a `hyper://` address or using PeerChat connects your device directly to other devices, and those peers see your IP address the same way a website does. That is what lets it work without a server, and there is no onion routing to hide it. Finding peers happens over a distributed hash table and over your local Wi-Fi; the nodes that help see a hashed topic, never a room key and never the content.

PeerChat rooms and direct messages are encrypted with keys only the people in them hold. In those made on PeerSky Mobile 0.1.2 or later, the key changes every hour and each file has a key of its own, so somebody who gets hold of a room’s key later cannot read what was said before. Those made earlier keep one key for good, so anybody who has it can read that room, past messages included. Either way, somebody removed from a room still holds its key. Every message is signed by its sender, and a message can reach you through another device in the room, still encrypted and checked against that signature. What is encrypted is the content, not the fact that two devices are talking.

Your PeerChat name, bio and photo are seen by everyone in the rooms you join. A new PeerChat profile starts in P2P Republic, a public room anyone can join, so people you do not know will see them there, along with your IP address while you are both online. You can leave it from the chat list at any time.

When you send a link in PeerChat, your phone opens the page once to make a preview, so that website sees your IP address as it would on a visit. The people you send it to get the preview inside the message, and their phones do not open the page. You can turn off Link previews in PeerChat's settings.

A public Hyperdrive upload can be opened by anyone with its `hyper://` address. A private one is encrypted with your identity's key, and it also goes to your own devices that hold that key, such as the desktop you linked: they find each other directly and list each other's private files, and a desktop keeps a copy of your phone's, made while your phone is on Wi-Fi. Nobody else can open them.

## Backups and Moving to Another Device

Link Device in Settings can move your data to another device or save it as a backup file. Both hold everything PeerSky keeps: tabs, bookmarks, history, settings, chats, notes, files, and the keys that make your chats and drives yours.

A move goes straight from one device to the other, the same way PeerChat does, and is encrypted so that only the receiving device can open it. Both screens show the same six characters to compare before anything is replaced. A backup file is encrypted with a passphrase you choose. It goes wherever you send it, and anyone who has both the file and the passphrase can open it, so keep the passphrase to yourself. Nobody, including us, can recover a forgotten one.

PeerSky keeps its data out of your phone's own backups: iCloud and computer backups on iPhone and iPad, and Google backups and phone-to-phone copies on Android. They would carry your keys onto another phone without asking, and that phone would then write to the same chats as this one. Use Link Device instead.

## Device Permissions

PeerSky may request camera, microphone, location, local-network, and file access when needed for a feature or when a website requests access. Each is asked for when it is first needed, and the app works without any of them. You can deny or revoke these permissions in your device settings, and where a refusal cannot be reversed from inside the app, PeerSky offers to open those settings for you.

## Downloads and External Services

PeerSky downloads EasyList and EasyPrivacy filter data to provide ad and tracker blocking. When you open an external app or service from PeerSky, that service handles data according to its own policy.

## Reports

Reporting someone in PeerChat opens an email to us, which you can read before you send it. It holds their name and short peer ID, the room's name and a hash of its key (never the key itself), and the message you reported, if you reported one. We use it only to act on the report, and we read every one. Nothing is sent unless you send that email.

If you sent us a report, ask at contact@p2plabs.xyz and we delete it, unless the law requires us to keep it.

## Deleting Your Data

There is no account on a server to delete. In PeerChat, Settings, Delete PeerChat profile removes your name, bio, photo, chats and keys from this device. Settings, P2P Data, Clear all P2P data removes everything peer-to-peer, and uninstalling PeerSky removes the rest. Messages you already sent stay on the devices of the people you sent them to, and we have no way to reach them.

## Children

PeerSky provides unrestricted browser access and is not directed to children, and we collect nothing from anyone.

The peer-to-peer web has no moderator. In PeerChat groups, pictures are screened on the phone before they are sent, text is filtered for abuse and slurs, and adult domains are blocked in links. Pictures that look explicit arrive hidden behind a warning. None of that replaces judgement about who you share a room key with.

We do not tolerate child sexual abuse or exploitation in any form. Report it from inside PeerChat or to contact@p2plabs.xyz, and we report what we learn to the authorities, including the National Center for Missing and Exploited Children. Our rules are in the [Terms of Use](TERMS.md).

## Changes

This policy may be updated as PeerSky changes. The latest version is published in this repository.

## Contact

For privacy questions or content-removal requests, email contact@p2plabs.xyz. Copyright notices go to the same address; what to include is in the [Terms of Use](TERMS.md#copyright). To report harmful public content, [open a Report harmful content issue](https://github.com/p2plabsxyz/peersky-mobile/issues/new?template=content-report.yml).
