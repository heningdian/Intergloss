# Intergloss

Intergloss adalah generator interlinear gloss, yaitu format anotasi linguistik standar internasional yang digunakan dalam publikasi ilmiah untuk menjelaskan struktur morfologi dan makna setiap unsur dalam sebuah kalimat.

**Interlinear Gloss Generator** is a standalone, 100% client-side web app for building
[Leipzig Glossing Rules](https://www.eva.mpg.de/lingua/resources/glossing-rules.php)-style
interlinear morpheme glosses — no backend, no build step, no data leaves the browser.

## Features

- Segment a sentence into words, then split each word into morphemes with `-` (affix) or `=` (clitic) boundaries.
- Type or quick-select Leipzig abbreviations (1SG, PST, ACC, PL, …) for each morpheme, with datalist autocomplete.
- Live, properly aligned interlinear preview (source text / gloss / free translation), with automatic small-caps rendering for grammatical abbreviations.
- Export, all generated in-browser:
  - Copy as an HTML snippet
  - Copy as LaTeX (`gb4e`-style `\gll`/`\glt`)
  - Download as a Word `.docx` file
  - Print / Save as PDF via the browser's native print dialog
- Drafts, templates, and recent glosses are saved to `localStorage` so nothing is lost on refresh.

## Running locally

This is a static site — just serve the folder and open it:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploying to GitHub Pages

Push this repository to GitHub and enable Pages for the root of the default branch
(Settings → Pages → Source: Deploy from a branch → `/ (root)`). No build step is required.
