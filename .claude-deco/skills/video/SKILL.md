---
name: video
description: Understand and configure video in deco.cx storefronts — the Video component, autoplay, and especially audio/sound. Use when the user asks about video, video sound, audio, "video with no sound", "video is silent", "how to unmute", muted, autoplay, or how to enable sound on an uploaded video.
---

# Video in deco.cx

Deco serves uploaded videos through its media server at `https://decoims.com`. The most common question about video is **"why does my video have no sound?"** — the short answer is that **deco strips the audio track by default** and you re-enable it with `?muted=false`.

---

## Why videos are silent by default

When a video is uploaded to a deco storefront, the media server (`decoims.com`) serves an **audio-stripped version by default**. This keeps the file small and is what browsers need for muted autoplay.

The behavior is controlled by a `muted` query parameter on the media URL:

| URL | Audio track | File size (example) |
|---|---|---|
| `.../video.mp4` (no param) | **removed** — silent | 3.08 MB |
| `.../video.mp4?muted=true` | **removed** — silent | 3.08 MB |
| `.../video.mp4?muted=false` | **present** — has sound | 3.59 MB |

The version with sound is a physically different (larger) file — the audio is genuinely absent from the default one, not just muted in the player. So no player setting will bring the sound back unless the URL requests the audio version.

### Enable sound

**Option A — media URL (always works):** append `?muted=false` to the video URL.

```
https://decoims.com/<site>/<id>/<file>.mp4?muted=false
```

**Option B — CMS panel (no code):** in the deco Admin, open the section/page holding the video and turn **off** the video's `muted` option. The CMS then serves the URL with `?muted=false`. The exact label depends on the section, but it maps to the same media parameter.

---

## Browser autoplay vs. sound — the important caveat

Getting the audio version of the file (`?muted=false`) is only half the story. Browsers **block autoplay of videos that have sound**. A video will only autoplay if it is muted; to play with sound it needs a user gesture (click/tap) or `controls`.

So there are two independent layers:

1. **The file** — does the served `.mp4` contain an audio track? Controlled by `?muted=false` on the media URL (deco media server).
2. **The player** — is the `<video>` element muted / autoplaying? Controlled by the `muted` and `autoPlay` HTML attributes.

Common combinations:

| Goal | File | `<video>` attributes |
|---|---|---|
| Silent background loop (autoplays) | default (`muted=true`) | `autoPlay muted loop playsInline` |
| Plays with sound after user clicks | `?muted=false` | `controls` (no `autoPlay`), or unmute on interaction |
| Autoplays, user can unmute | `?muted=false` | `autoPlay muted loop` + an unmute button that sets `video.muted = false` |

You cannot have a video that autoplays **and** starts with audible sound — that is a browser policy, not a deco limitation.

---

## The `Video` component

**Import:** `apps/website/components/Video.tsx`

```tsx
import { forwardRef } from "preact/compat";
import type { JSX } from "preact";
import { getOptimizedMediaUrl, getSrcSet } from "./Image.tsx";

export type Props =
  & Omit<JSX.IntrinsicElements["video"], "width" | "height" | "preload">
  & {
    src: string;
    width: number;
    height: number;
    forceOptimizedSrc?: boolean;
  };
```

It renders a native `<video>` and **spreads all standard video attributes through** (`{...props}`), so any HTML `<video>` attribute works directly:

| Prop | Type | Notes |
|---|---|---|
| `src` | `string` | Media URL — add `?muted=false` here for sound |
| `width` / `height` | `number` | Required; used for srcset |
| `muted` | `boolean` | Player-level mute (needed for autoplay) |
| `autoPlay` | `boolean` | Only works when `muted` is also set |
| `loop` | `boolean` | Repeat playback |
| `controls` | `boolean` | Show native player controls |
| `playsInline` | `boolean` | Prevents iOS fullscreen takeover |
| `loading` | `string` | Defaults to `"lazy"` |
| `forceOptimizedSrc` | `boolean` | Route `src` through the deco media optimizer |

```tsx
import Video from "apps/website/components/Video.tsx";

// Silent, autoplaying background video
<Video
  src="https://decoims.com/site/id/hero.mp4"
  width={1280}
  height={720}
  autoPlay
  muted
  loop
  playsInline
/>

// Video the user plays with sound
<Video
  src="https://decoims.com/site/id/promo.mp4?muted=false"
  width={1280}
  height={720}
  controls
/>
```

---

## Troubleshooting: "the video has no sound"

1. **Check the media URL.** If it ends in `.mp4` with no `?muted=false`, the served file has no audio track. → Add `?muted=false`, or turn off `muted` for that video in the CMS panel.
2. **Check the player.** If the URL already has `?muted=false` but it is still silent, the `<video>` element is probably `muted` (required if it also `autoPlay`s). → Remove `muted`/`autoPlay`, add `controls`, or add an unmute button. Remember: autoplay-with-sound is blocked by browsers.
3. **Verify.** Open the media URL with `?muted=false` directly in a browser tab — it should now play with audio (and download a slightly larger file than the default URL).

---

## Caching note

Videos are served with `Cache-Control: public, max-age=31536000, immutable` (1 year). The muted and non-muted variants are cached under different URLs, so switching `?muted=false` fetches a fresh, separately-cached file — no cache-busting needed.
