# Build a page with the builder

The builder is where you compose a page from blocks while you see the real page.
You pick blocks from a palette, edit their text and options in a panel,
and the site's own frontend draws every change.
The admin never draws a block.
It draws only the marks over the page: the outline of the selected block, its label and its actions.

You need the permission **Preview drafts on the frontend**, and to change the page,
permission to update it in the Content Manager.
Without the second one the builder opens read-only.
The builder also reads the site of the page, so your role needs permission to read Sites.
It composes the dynamic zone `sections`; a content type whose zone has another name
(`blocks`, for example) has no **Open in the builder** link and cannot be opened by its address.

## Open it

Open the preview of a page (the **Preview** button of the Content Manager),
then **Open in the builder**.
The address is `/admin/plugins/micelio/builder/<content type>/<documentId>`.
**Back to the entry** (the arrow in the toolbar) returns to the Content Manager.

## The page

- **Toolbar.**
  The title, whether the page is a draft, and where autosave stands.
  The gear next to the title opens the [page settings](pages.md), for a page type that has them.
  Phone, Tablet and Desktop set the width of the preview.
  **As static site** shows every island as its static alternative.
  The meter is the weight of the page's blocks against its budget, measured by the frontend.
  **Save** saves now.
- **Blocks (left).**
  The blocks your site offers for this kind of page, each with what it adds to the page in kB.
  A block with a blue badge is an _island_: it loads a script when it is used and has a static
  alternative. The icon is its kind (3D, runtime, media, diagram or data); the badge on hover,
  in the panel and in the page says how it loads, _in view_ or _on click_, and what it weighs.
  Type in the search box to find a block.
  A block the site does not allow on this page type is dimmed and says so.
  A block that costs more than what the budget has left stays available,
  and says that publishing will be refused until the page fits.
  Under the palette, **Page blocks** lists the blocks of the page in order.
- **The page (centre).**
  Click a block to select it, or pick it in the list.
  The outline, its name and position, and the buttons up, down and duplicate sit over it.
  **+ Add a block here** at the end of the page adds to the end.
- **The selected block (right).**
  **Presentation** has one row of buttons for each option the block exposes
  (columns, density, tone…).
  **Content** has the block's text fields and its items.
  Select an item to edit it: the panel shows where you are
  (_Feature grid › Item 2_), and `Esc` goes up one level.
  Links are edited in the Content Manager's form.
  A media field (a Gallery's images, an item's icon) shows each file with its thumbnail, name and
  size, **Replace** and **Remove**; a field that takes several files adds, removes and reorders
  them. **Choose a file** and **Replace** open Strapi's own Media Library, the one the Content
  Manager opens, so the files, folders and permissions are the same; the builder never uploads.
  The alternative text of an image sits under it and is the file's own `alternativeText` in the
  Media Library, saved when you leave the field (with the permission you have there). **Decorative,
  no text needed** stores an empty text for that file. Nothing checks the alternative text yet: a
  missing one is only marked in the panel (_Required by the accessibility check_), and neither
  save nor send to review is held by it.
  A required field that is empty, text or media, is marked, and so is the block in the list and in
  the page.
  The page is not saved while one is empty: the toolbar says _Not saved: a required field is empty_,
  and everything you changed is saved as soon as the text or the file is there.
  A block that the site disabled after it was put on the page stays on the page:
  you can select, move and remove it, and the panel says the catalogue no longer lists it.
  A copy of it is not offered: the site would refuse it as a new block.

## Islands

A page may hold one Scene with the variant _background_;
a second one is refused when the page is saved.

- **In the page.** An island carries its icon in its corner. Hover it to read how it loads and
  what it weighs. When it is selected, its label says its kind (_Scene · 3D island · 2 of 3_) and a
  **static** button shows this one island as its static alternative, without leaving the dynamic
  page; the badge then reads what replaced it (_3D → poster_). **As static site** in the toolbar
  does the same for the whole page. The choice is not saved: a reload of the preview forgets it,
  and the builder sends it again.
- **In the panel.** _What this costs the visitor_ says what the island adds and when it loads.
  The fields of its static alternative (a Scene's poster and alt text, a Playground's expected
  output) are marked required: a page cannot be sent to review while one is empty, and the panel
  says which. A poster is chosen in the Content Manager's form, as every file is.
- **Run here and fill expected output** (Playground) is shown disabled: the admin has no runtime
  to run the code with yet. Write the expected output by hand.

## Compose

- **Insert a block:** select a block in the page and press `Enter` on a row of the palette, or
  click the row. The new block goes after the selection, or at the end of the page if nothing is
  selected.
- **Insert in a place:** drag the row into a gap between two blocks. The gap opens in the preview
  and says _Drop here_. Only gaps between blocks accept a drop.
- **Move a block:** select it and press `⌥↑` or `⌥↓` (`Alt` on Windows and Linux), or use the
  arrows in the panel, or drag it in the **Page blocks** list.
- **Duplicate or remove:** the buttons in the panel (and duplicate in the page's marks).
- **Edit text:** type in the panel. The text shows in the preview as you type, before it is saved.
- **Pick files:** a media field of the panel opens the Media Library; the preview shows the file
  once the page is saved. Changing the files of a field is a step you can undo (the message
  says _Files changed_); writing an image's alternative text is not.
- **Undo:** **Undo** in the message after a change. Undo goes back one step in this visit, and
  typing in a field or an item is one step for each pause; it forgets nothing of the page's
  history in Strapi.

## Autosave

The page saves about a second after your last change, one save at a time,
and the preview loads the new draft once the save is done.
The toolbar says _Saving…_, _Saved_ with the time, _Unsaved changes_ or _Not saved_.

If the server refuses the save, a notification says why in the server's own words,
and the page shows the same words with **Go to the block**, which selects the block it is about
(a block that was refused is not stored, so the button works in this page, not in a new tab).
The page does not try the same content again: change something, or press **Save**.

### Two people on one page

Each save tells the server which version of the page it was made over, and the server refuses it
when someone else saved the page since: the check and the write happen in the same turn, so two
saves that cross cannot both go through. Every few seconds while the page is in view the builder
also reads the page, to tell you early. If someone else saved, it stops saving and shows
_This page was saved somewhere else_:

- **Load their version** drops what you changed here and loads theirs.
- **Keep my version** (shown when you have unsaved changes) overwrites theirs on the next save.

Nothing is overwritten until you choose.
Blocks and items the other person removed come back as new ones when you keep your version, and an undo never brings back one that the CMS no longer holds. Files stay attached.
The server keeps the turns in its own process: with several Strapi servers on one database
the window between two saves is a database round trip, not zero.
A save from the Content Manager's form sends no version and is not refused, so it can still
replace what the builder saved a moment earlier; the builder then shows the notice.

## What is not here yet

The SEO tab and the Template tab of the page settings, the complete keyboard and the shortcuts
sheet each have their own issue. Sending a page to review, scheduling and publishing it are in
[Review, schedule and publish](review.md).

## Motion

The admin moves only to explain a change of state, with three durations (120, 200 and 320 ms).
With _reduce motion_ set in your operating system, every transition lasts 1 ms and nothing travels;
the state is still shown by colour, text and position.
