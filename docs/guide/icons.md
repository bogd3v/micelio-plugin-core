# Picking an icon

An icon is a **name** of the catalogue, never a file: `bolt`, `map-pin`. A field of the type **Icon** stores that name as text, so an icon has no upload and no alternative text to write, and an optional icon left empty renders nothing. The set is [Tabler Icons](https://tabler.io/icons) at the version the core pins; [`docs/icons.md`](../icons.md) says how it is pinned and where the Spanish labels come from.

## Where you meet it

- In the **builder**, in the panel of the selected block (or of an item), under **Content**: each icon field shows a row with its glyph, its label and its name.
- In the **Content Manager**, on any content type, component or block that a developer gave a field of the custom field **Icon** (`micelio.icon`, UID `plugin::micelio.icon`): the same row, with the form's label and hint.

## Choose an icon

1. Select the row, or focus it and press `Enter`. A dialog opens under the field with the search focused.
2. Type what you look for. The search matches the name, the label in English and in Spanish (_rayo_ finds _Bolt_), the category and Tabler's own tags (_thunder_ finds it too). The category chips narrow it: **All**, the first categories and **More** for the rest. A name that has no Spanish label shows its English label in Spanish.
3. Pick a glyph. The dialog closes and the field shows the icon; the page is saved as any edit is, with **Save** in the builder or the Content Manager's own button.

The footer of the dialog counts the matches (_12 of 5,233_) and names the pinned version of the set. The list shows 120 glyphs at a time; **Show more icons** adds the next ones.

### With the keyboard

| Key                   | Does                                                                              |
| --------------------- | --------------------------------------------------------------------------------- |
| `Enter` on the row    | Opens the dialog, on the search                                                   |
| `↓` in the search     | Enters the list, at the picked icon or the first                                  |
| Arrows, `Home`, `End` | Move between glyphs, six to a row; `↑` from the first row goes back to the search |
| `Enter` or `Space`    | Picks the glyph that has the focus and closes the dialog                          |
| `Esc`                 | Closes the dialog and keeps the icon the field had                                |

## Remove it

**Remove the icon** (the × in the row) stores _none_. An empty field is drawn as a dashed row with **Choose an icon**, and a block with no icon renders none: it is a state, not a missing value. A required icon that is empty is marked in the builder, as a required text is.

## What is stored

The name exactly as you picked it. When Tabler renames a glyph, the core keeps the old name as an alias of the new one: a page that stored the old name keeps it (the field never rewrites it), shows the new glyph, and the picker finds the glyph by either name. A value that is not a name of the catalogue or one of its aliases is refused when the page is saved: `iconInvalid` in [`docs/api.md`](../api.md#errors).
