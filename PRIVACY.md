# PeerSky Mobile Privacy Policy

Last updated: September 28, 2026

PeerSky Mobile is a web and peer-to-peer browser. There are no accounts, no
analytics and no servers of ours, so there is nowhere for us to collect anything
even if we wanted to. Nobody at P2P Labs can see what you browse, who you talk
to, or that you use the app at all.

This policy explains what the app handles, where it goes, and the parts that are
not perfect.

## Data Stored on Your Device

PeerSky stores browser settings, open tabs, history, bookmarks, download records, cached filter lists, and peer-to-peer application data on your device. This data is used to provide browser features and is not sent to a PeerSky analytics service.

You can remove browsing and peer-to-peer data from the Data Clearing and P2P Data sections in Settings. Files saved through the system download manager may also need to be removed through the Downloads screen or your device's file manager.

## Websites, Searches, and Peer-to-Peer Services

Websites you visit can receive standard network information, including your IP address, and may collect data under their own privacy policies. Searches typed into the address bar go to the engine chosen in Settings, and that engine's policy applies rather than this one.

Peer-to-peer is the part worth understanding. Opening a `hyper://` address or using PeerChat connects your device directly to other devices, and those peers see your IP address the same way a website does. That is what lets it work without a server, and there is no onion routing to hide it. Finding peers happens over a distributed hash table and over your local Wi-Fi; the nodes that help see a hashed topic, never a room key and never the content.

PeerChat rooms and direct messages are encrypted with a key only the people in them hold, and attachments with a key derived from it. Two honest limits: a room key is a shared secret, so anybody who has it can read that room including its past messages, and it never rotates, meaning somebody removed from a room still holds the key. What is encrypted is the content, not the fact that two devices are talking.

Public Hyperdrive uploads are shared with the peer-to-peer network and can be accessed by anyone who has the corresponding Hyper URL. Private Hyperdrive uploads remain in isolated local app storage unless you choose to share or transfer that storage.

## Device Permissions

PeerSky may request camera, microphone, location, local-network, and file access when needed for a feature or when a website requests access. Each is asked for when it is first needed, and the app works without any of them. You can deny or revoke these permissions in your device settings, and where a refusal cannot be reversed from inside the app, PeerSky offers to open those settings for you.

## Downloads and External Services

PeerSky downloads EasyList and EasyPrivacy filter data to provide ad and tracker blocking. When you open an external app or service from PeerSky, that service handles data according to its own policy.

## Children

PeerSky provides unrestricted browser access and is not directed to children, and we collect nothing from anyone.

The peer-to-peer web has no moderator. Media is screened on the device before it is sent and again when it arrives, text is filtered for abuse and slurs, and adult domains are blocked in links. None of that replaces judgement about who you share a room key with.

## Changes

This policy may be updated as PeerSky changes. The latest version is published in this repository.

## Contact

For privacy questions or content-removal requests, email contact@p2plabs.xyz. To report harmful public content, [open a Report harmful content issue](https://github.com/p2plabsxyz/peersky-mobile/issues/new?template=content-report.yml).
