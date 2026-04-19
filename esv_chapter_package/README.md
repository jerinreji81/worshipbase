# ESV chapter package

This package was generated from the uploaded `ESV.json.txt` source.

## Structure

- `bible-index.json` — small index with version/meta info and book/chapter counts
- `bible/<book-slug>/<chapter>.json` — one JSON file per chapter

Example paths:
- `bible/john/3.json`
- `bible/psalms/23.json`

## Chapter file shape

```json
{
  "version": "ESV",
  "versionName": "English Standard Version 2011",
  "book": "John",
  "bookSlug": "john",
  "chapter": 3,
  "verseCount": 36,
  "verses": [
    { "verse": 16, "text": "For God so loved the world..." }
  ]
}
```

## Notes

- Book folder names use lowercase slugs for easy fetch paths.
- Verse text was flattened from the tokenized source format into plain readable strings.
- This package preserves the uploaded text content as-is after flattening.
