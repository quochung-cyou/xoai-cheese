# Book files

The textbook viewer (`scenarios/book.html`) is fully wired up — it imports
PDF.js and PageFlip from `../vendor/`, reads `catalog.json`, and renders a
page-flip reader. What it needs is the PDF itself, which is **not in this
repository** (it is copyrighted material).

## To make the book work

Drop the PDF here with the exact filename the catalog expects:

```
public/mb-assets/books/sgk-ket-noi-tri-thuc-toan-10-tap-1.pdf
```

Nothing else to change — the picker item "Toán 10 — flipbook", the classifier,
and the viewer all resolve it through `catalog.json`.

## Adding more books

1. Put the PDF in this folder.
2. Add an entry to `catalog.json`:

```json
{
  "entries": {
    "my_book": {
      "name": "Display name",
      "file": "books/my-book.pdf",
      "description": "Optional. Shown as the analysis note."
    }
  },
  "aliases": {
    "my book": "my_book",
    "the alias a user might type": "my_book"
  }
}
```

`file` is relative to `/mb-assets/`, so it is always `books/<filename>`.

## Notes

- The catalog's first entry is the default when no book name is given, so the
  ordering in `entries` matters.
- The reader restores the last page you were on; that state rides on the
  canvas element's `customData`, so it survives reloads and board switches.
- Large PDFs: the file is served as a static asset. Cloudflare Pages has a
  25 MiB per-file limit on the free plan — split or compress beyond that.
