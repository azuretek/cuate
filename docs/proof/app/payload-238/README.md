# A plugin payload drawn as the link it is (#238)

Close crops from one design-capture run over the fake engine's synthetic fixtures: one per payload case, at desktop
(1100x720) and the 390px phone width, in light and dark, with the default palette and the imported theme. Each crop is
the message row plus a small margin.

The cases:

- **238a-link-card**: a payload carrying a title and a still, drawn as a link card. It shows the site, the title the
  payload itself carried, the URL, and the picture taken from our own stored attachment.
- **238b-link-only**: a payload whose temp file is already gone. The link card shows the site and the URL, with no
  image and no title.
- **238c-unparseable**: a payload nothing can parse. One quiet "Attachment" row, and the payload's own filename
  appears nowhere.
- **238d-payload-media**: a payload that is media with no link at all. Drawn as an ordinary image attachment, never
  under the payload's name.
- **238e-ordinary-link**: a plain URL in the message text, with no payload beside it. Left exactly as it was, as text.

Nothing is fetched from a third party to decorate a message on render: the link card's picture is one of our own
stored attachments, and opening the link stays the reader's own action. Inline playback of a linked video is
deliberately out of scope for this change and tracked separately.

Captured from fixture data alone on a 4 vCPU Linux guest under a virtual display, from the same fake engine the
desktop smoke runs against.
