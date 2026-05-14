# CaseOh Analyzer

Static site for GitHub Pages. It fetches the public Google Sheet, predicts the next hoodie color with a recency-weighted model, tracks off days, and lists games played.

## Setup
- Ensure the Google Sheet is public (Anyone with link can view).
- Put text markers in the sheet:
  - `WORN` in the cell of the color worn that day.
  - `OFF` in column A of the `Hoodie` sheet for off days.
  - `dark red 1` or blanks are treated as not worn.
- Add games to the `Games` sheet with `Date`, `Game Name`, `YouTube Link`, and `Channel` columns.

## Publish on GitHub Pages
1. Push these files to a GitHub repo.
2. Enable GitHub Pages on the main branch and root folder.
3. Visit the Pages URL.

If you want a different sheet, update `SHEET_ID` in `app.js`.
