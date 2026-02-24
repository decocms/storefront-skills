# HTML Size

HTML size affects TTFB and how long the browser takes to render the page. Below are common sources of bloat and how to reduce them.

---

## 1. JSON data for the framework

Many frameworks inject large JSON payloads into the HTML, for example:

```html
<script id="__FRSH_STATE_">{}</script>
<script id="__NEXT_DATA__" type="application/json" crossorigin="">{}</script>
```

**What to do:** Reduce JavaScript sent to the client. Pass only the props that client components need.

---

## 2. JSON data for events

Sites sometimes store event-related data in the HTML:

```html
<div data-event="%7B%7D"></div>
```

**What to do:** Send only the data that will actually be used.

---

## 3. JSON for SEO structured data

```html
<script type="application/ld+json">{
  "@context": "https://schema.org",
  "@graph": []
}</script>
```

**What to do:** Include only the structured data that is valid and used; avoid large or redundant objects.

---

## 4. Hidden elements for responsiveness

Sites sometimes hide whole blocks per breakpoint, doubling (or more) the HTML:

```html
<header class="hidden md:block">a lot of HTML</header>
<header class="block md:hidden">a lot of HTML</header>
```

**What to do:** Serve only the HTML needed for the requesting device (e.g. split or choose on the server).
