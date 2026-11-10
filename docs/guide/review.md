# Review, schedule and publish

The builder (`docs/guide/builder.md`) moves a page through the editorial workflow (ADR-0017, section
5): send to review, schedule, approve and publish, send back. The **In review** page lists what
waits for a reviewer. The server decides every move; the admin shows what it answered.

## The buttons of the builder

The buttons follow **Save** in the toolbar, and the badge next to the title says where the page is.
Each state offers the moves of the state machine that a person makes:

| State     | Buttons                            |
| --------- | ---------------------------------- |
| Draft     | **Schedule**, **Send to review**   |
| In review | **Send back**, **Publish**         |
| Scheduled | **Back to draft**                  |
| Published | **Unpublish**, **Publish changes** |

They wait while the page holds changes that are not saved yet: the server checks the saved draft.
A role that the site's policy leaves out of a move still sees the button, and the server refuses it
(`editorialTransitionForbidden`). Who may make each move by default is in
[docs/api.md](../api.md#editorial-transitions).

### Send to review

The dialog asks the server for a dry run of the move first, which runs its checks and writes
nothing, and lists:

- whether a block lacks a required field (the page is not saved until it has one);
- that every island has its static alternative (the dialog opens only once the server agrees);
- the page's weight against its budget, when the cost meter has measured it;
- each warning of the server: `linkToDraft`, a link of a block to a page of the same site that is
  not published, which answers 404 until that page is.

A warning does not stop the page: the button reads **Send anyway**. The note for the reviewer is
optional, at most 1000 characters; the reviewer reads it on the In review page.

### Schedule

The dialog takes a date and a time in your time zone. The scheduler publishes the page within a
minute of that time (`scheduledPublishRule`), and the page must pass the publish checks then: its
budget, and its sample text if it was made from a template.

Editing a scheduled page moves it back to **Draft** and clears its time: what was scheduled is not
what would publish. The builder says so after the save, with **Schedule again**. This holds for
every edit, through the builder, the Content Manager or the content API.

### Approve, send back, unpublish

**Publish** (**Approve** on the In review page) publishes a page in review. **Send back** opens a
dialog for a note to the editor and moves the page back to Draft; the editor finds the note at the
top of the builder until the next move. A move without a note clears the previous one.

## Refusals and warnings

A refused move is a notification of the admin, from the problem detail the server answered (its
`code` is at the end of the text):

| `code`                                | What it says                                    |
| ------------------------------------- | ----------------------------------------------- |
| `pageOverBudget`                      | Weight against the budget, the heaviest blocks  |
| `previewUnavailable`                  | The page could not be measured                  |
| `editorialTransitionForbidden`        | The site's policy or your permissions refuse it |
| `editorialPublishAtInvalid`           | The time of a schedule has passed               |
| `islandAlternativeMissing`            | The island block and its empty field            |
| `sampleTextPresent`                   | The block that holds sample text                |
| `seoInvalid`                          | The SEO fields to fix, in Page settings         |
| `descriptionRepeatsTitle` (a warning) | The description only says again the title       |
| `linkToDraft` (a warning)             | How many links, to which draft pages            |

When the problem names a block, the notification has **Go to the block**: it opens the builder in a
new tab with that block selected (`?block=<id>&position=<n>`). `previewUnavailable` links to the
preview page instead. [docs/api.md](../api.md#errors) lists every code.

## The In review page

**Micelio → Content → In review** lists the pages waiting for review, by site, the oldest first,
with the editor's note. It needs the permission **Read the In review page**
(`plugin::micelio.review.read`), which the Super Admin has; it lists only the pages you may read in
the Content Manager (an Author, its own pages), and of each page only the fields you may read: a
page whose title you may not read is listed under its document id, and its note is left out when you
may not read the note of the editorial component. Next to the item in the sub-navigation a badge
shows how many pages wait, over every site, as the page lists them; it is read again each time you move
to another page of the section, so approving a page lowers it, and it shows nothing when no page waits
or the count could not be read. **Approve** publishes a page and **Send back** asks for a note; both are moves
the server decides, as in the builder.
