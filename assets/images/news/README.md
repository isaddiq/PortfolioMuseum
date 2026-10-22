# News images

Drop images for news items here, then reference them from `data/news.json`.

The first 4 entries of `data/news.json` (top of the file) are the Home
highlight cards; every entry after them is listed below as News. Add a new item
at the top of the file and it becomes a highlight, pushing the oldest highlight
down into the list.

- `images[].src`: the picture(s) shown when a news item is expanded. A single
  image is shown whole (not cropped).
- `thumbnail` / `thumbnailAlt` (optional): the picture on the highlight card.
  The card image is short and wide (about 2:1) and is cropped from the centre,
  so a wide figure deserves its own crop here. Without it, the card uses the
  first `images[].src`.
- `images[].fallback` (optional): shown if the image fails to load.

LinkedIn note: posts and their images cannot be fetched automatically (LinkedIn
requires login and blocks automated access). To use a LinkedIn image, open the
post, save the image, drop it in this folder, and point the JSON at it.

Recommended: landscape JPG, about 1200 to 2400 px wide, optimized for web.

## Live LinkedIn post (embed): "live while static"

To show the *actual* LinkedIn post (image, text, reactions) live on the static
site, use LinkedIn's official embed instead of a saved image:

1. On LinkedIn, open the post → the ⋯ menu → **Embed this post**.
2. Copy the URL inside the iframe `src`, e.g.
   `https://www.linkedin.com/embed/feed/update/urn:li:share:7300000000000000000`
3. Add it to that item in `data/news.json` as `"embedUrl": "...that URL..."`.

When `embedUrl` is set, the expanded news item renders the live post in an
iframe and skips the static image for that item. (Automatically listing *all*
your posts is not possible on a static site; LinkedIn has no open API and
blocks cross-origin fetches, so embeds are added per post.)
