# joejoe's second brain

A full-page dashboard for [Obsidian](https://obsidian.md) that turns the vault you already have into a second brain: tasks on a Kanban board, a calendar with a day planner, projects with their own pages, checkbox habit tracking with statistics, and an A–Z library of every note. Everything is connected, and everything stays in plain Markdown.

It doesn't ask you to reorganize anything. It reads the notes, tasks and frontmatter you already write, and when you act on the dashboard (tick a task, drag a card, check a habit) it writes the change back to the same Markdown line or property you'd have edited by hand.

![Home](docs/screenshots/home.png)

---

## Contents

- [Features](#features)
- [Install](#install)
- [Getting started](#getting-started)
- [How your notes map to the dashboard](#how-your-notes-map-to-the-dashboard)
- [Settings](#settings)
- [Commands](#commands)
- [Development](#development)
- [Project structure](#project-structure)
- [Roadmap](#roadmap)
- [License](#license)

---

## Features

### Home: a page you can make your own
- A cover image, a page icon and a letter-spaced title, all editable in place. Hover the top of the page to change the icon (emoji, any [Lucide](https://lucide.dev) icon, or an image), add, reposition or remove the cover (from your vault, a link, or uploaded from your computer), or rename the page.
- A daily quote and a colored row of **quick links** to folders, notes, `#tags` or websites.
- **Things to do** at the top: urgent, overdue and due-today tasks with quick add, next to **upcoming** deadlines, a mini calendar and today's daily note.
- **Habits** for today as checkboxes, or this week's grid.
- **Widgets:** a countdown to your next deadline, year/month/week/day progress, a flip clock, and your own **images** (with a crisp-pixels mode for pixel art).
- **Notebook** (recently edited / due soon / check again), a **projects** column, and the **knowledge lab** (your areas, tags or folders).
- **Customize page:** reorder or hide any section, and toggle widgets.

### Tasks: your Kanban plugin board
![Tasks](docs/screenshots/tasks.png)
- The **Board** view shows one board file in the [Kanban plugin's](https://github.com/mgmeyers/obsidian-kanban) format. Pick an existing board or create one, and the same file still opens in the Kanban plugin. Only that board's cards appear, never tasks scattered through your other notes.
- Everything you do edits the board file in the Kanban plugin's own format:
  - drag cards between lists, or reorder them within a list (a floating card and a drop gap show where it lands; on touch screens, press and hold)
  - tick cards complete, or drop them into a list marked **Complete**
  - add cards with **+ Add a card**, and double-click a card to edit it
  - set dates (`@{2026-10-20}`), move cards between lists, or delete them from the ⋯ menu
  - add, rename, move and delete lists
- The **List** view still shows tasks found across your notes, with filters (project, due date, priority, label), grouping and sorting.

### Calendar and day planner
![Calendar day popup](docs/screenshots/calendar.png)
- **Month, week and timeline** views, with layers you can toggle: tasks due, scheduled and done; project and note deadlines; meetings (any note with `date:` / `time:` in its frontmatter); daily notes; notes created and edited.
- Drag a task onto a day to set its due date.
- **Click any date** to open the day popup: a month grid, the day's agenda and what's coming up (with status pills), plus that day's notes and a todo list with quick add.

### Projects
![Project page](docs/screenshots/project.png)
- Project cards showing progress, open/urgent/overdue counts, the next due date and the deadline.
- Each project gets its own page:
  - a stat strip and an **editable description** (Markdown, saved to the note's `description` property)
  - open tasks by status and weekly activity
  - deadlines, linked notes, daily-note mentions and recently completed tasks

### Courses (school)
Your subjects, each with a code, instructor, schedule, room, units, semester and color. They work like projects, and you can mark each one **active** or **inactive** for the semester.
- **Courses tab:** cards for *This semester* and, collapsed, *Not this semester*. Each card has a progress bar, open/urgent/overdue counts, the next due date, a quick **Add task** button and an **Active** switch.
- **Plan semester:** name the term and tick the courses you're taking. Everything else goes inactive, and the semester name is set on the ticked courses.
- **Course page:** the project page (description, open tasks, deadlines, linked notes, daily-note mentions, activity) with the course details on top. You can mark it active or inactive there, or edit its details.
- **Tasks belong to a course** when they're in the course note or its folder, when they link `[[Course]]`, when their note has `course: …` in its properties, or when they're tagged with the course code (`#cs201`).
- **Inactive courses stay out of the way:** their tasks are hidden from Home, Tasks, the Calendar and Review (a setting, also toggled from the Tasks toolbar), but always show on the course page.
- **Tasks show a colored course chip** (`CS 201`). The Tasks filter has *All active courses* and each course, and quick capture lists this semester's courses first.
- **Turning notes into courses:** put them in `Courses/`, tag them `#course`, or add `type: course`. Properties: `code`, `instructor`, `schedule`, `room`, `units`, `term`, `color`, `active`.

### Habits and trackers
![Habits](docs/screenshots/habits.png)
- **Checkbox habits**: tick any day in the week grid, and move between weeks. Each tick writes `habit: true` / `false` into that day's daily note.
- **At a glance:** done today, % of your weekly goal, completion, perfect days, best current streak, and completion by habit.
- **Statistics** across every habit:
  - show/hide chips, and a range of 7d, 30d, 90d, 1y or all
  - one combined table with streak, best, rate, a heatmap strip and this week's goal for each habit
  - a habits-done-per-day chart
  - a **focus** view per habit, with a 12-month heatmap and days per week against your goal
- **Other trackers** (optional) for numbers or stages, such as weight, expenses or job applications. They read from daily-note fields, one note per item, or a Markdown table, and give you totals, trends, funnels, goals and an entries table.

### Money: income and expenses
A **Money** card in the tracker list opens a monthly view of what came in and what went out (PHP by default).
- **Quick add** reads like a sentence: *Spent / Received ₱[amount] on [category] · [note] · [date]*. You can also type `250 food lunch` or `+52000 salary` into the amount box and the rest fills in.
- **Figures:** received, spent (with the daily average), net (with the share of income kept), and what's left to spend, with a per-day allowance for the rest of the month.
- **The month as a curve:** running spending against a dashed budget-pace line, with a projection to month end ("On track for ₱32,010").
- **Where it went:** categories largest first, each with its amount, a bar, a budget marker and "₱X left / ₱X over" written out. Click a category to filter the ledger. **Where it came from** lists income sources.
- **Ledger:** grouped by day with daily totals. Filter by spent or received, and search. Click a row to edit or delete it; deleting offers Undo.
- **Budget & categories:** set a monthly budget and optional budgets per category, and rename, recolor, add or remove categories and income sources.
- **Commands:** **Log expense**, **Log income** and **Open money**.
- **Storage:** plain Markdown, one table per month in `Finance/Ledger/YYYY-MM.md`, editable by hand.

### Library
![Library](docs/screenshots/library.png)
- An A–Z index of every note, grouped under letter headers with divider lines and with folder, type and date in aligned columns. Sorted by recent, it groups by month instead.
- Filter by folder (including subfolders), type, tag or area. The letter rail jumps between groups.
- Three views: large index, notebook list, and cards.

### Quick capture
![Quick capture](docs/screenshots/capture.png)
- Every field visible at once: title, task or note, priority, due date (date field plus Today / Tomorrow / Next week), labels with an inline *new label* field, project, and where to save (today's note, Inbox, or the project's note).
- Open it from the **capture** button, the command palette, or a hotkey you assign.

### Inbox triage
- Captured tasks (your Inbox file) and fleeting notes (the fleeting-notes folder) wait in one queue, with a count badge on the tab.
- Work through them one at a time. For a task: set priority, due date, labels and project, then **move to the project**, **move to today's note**, mark **done**, or **delete**. For a fleeting note: **make it a permanent note** or a **literature note**, move it into a project folder, or delete it (to the system trash).

### Notes: Zettelkasten tools
- **Create** fleeting, literature (book / article / video / podcast, with author and link) and permanent notes from templates. Permanent notes can get a `YYYYMMDDHHmm` id.
- **Orphans:** notes with no links in or out, each with **link suggestions** (shared tags, title words, neighbours and area) and one-click **+ link**, which adds it under `## Related`.
- **Resurface:** a daily pick of older notes to re-read, with a "reviewed" button.
- **Last opened note:** link ideas for it, and **split into atomic notes**, which turns each `## ` section into its own permanent note and leaves links behind.

### Weekly review
- Any week at a glance: tasks done, slipped tasks (move them all to tomorrow in one click), project progress, habits, notes written, inbox count and orphans.
- A checklist (editable in settings) and reflections, saved per week. **Write review note** saves everything to `Reviews/2026-W43.md`.

### Secrets vault
A small password manager for API keys, tokens (PATs), logins and secure notes, so they never end up in a note or a repo.
- **Encrypted at rest:** AES-256-GCM, with the key derived from one master password (PBKDF2-SHA256, 600,000 iterations, random salt, fresh nonce on every save). Only ciphertext is written; nothing goes into `data.json`, the index or the console.
- **Kept outside your vault by default** (`%APPDATA%\joejoe-secrets\vault.enc` on Windows), so it never syncs or gets committed. If you move it into a git repository, the file is added to that repo's `.gitignore` and you'll see a warning.
- **Two-pane manager:** search on the left (Enter copies the first match), details on the right. Values stay masked until you reveal them, fields are custom, and notes are encrypted too.
- **Locks itself** after 5 idle minutes (configurable) and when Obsidian closes. **Copied secrets are cleared** from the clipboard after 30 seconds.
- Saves are atomic (temp file, then rename), and the previous version is kept as `vault.enc.bak`. There is no password recovery.
- Open it from the key icon in the ribbon or **Open secrets vault**. Desktop only.

### Companion theme: Joejoe Gallery
An Obsidian theme for the whole app (in `theme/Joejoe Gallery/`), not just the dashboard.
- **Colors:** warm espresso in dark mode, parchment in light mode, and soft gold accents.
- **Type:** serif titles and headings (Iowan Old Style / Palatino / Georgia) over an Inter / Segoe UI body. Headings 4–6 and table headers are small spaced-out uppercase labels.
- **Panels:** rounded modals, menus, callouts and buttons with thin edges, and quieter sidebars and tabs.
- **Install:** `npm run deploy -- "<vault>"` installs it next to the plugin. Then pick **Joejoe Gallery** under *Settings → Appearance → Themes*.

### Split-panel cover
The Home header is a dark band with your cover image split into five black-and-white panels. With no image set, it draws a black-and-white mountain landscape. Hover the band to change the image, reposition it, or switch to a single full-width image.

### Pixel effects
Ordered (Bayer) dithering in the 1-bit, pixel-art spirit of the dashboard, each one toggleable:
- **Pixel field:** an animated dithered plasma widget. Move the mouse to light it up, and click to send out ripples.
- **Dissolve transitions:** switching tabs reveals the page through a quick pixel dissolve.
- **In your notes:** a `dither` code block shows a dithered image (with the hover reveal) or a pixel field anywhere in your vault:

  ````markdown
  ```dither
  src: Attachments/photo.png
  palette: gameboy
  pixel: 3
  height: 240
  ```
  ````
  Leave out `src` to get a pixel field instead. Palettes: `theme` (your theme's ink on its background), `gameboy`, `amber`, `ice` and `rose`.

Pixel size and palette are set under *Settings → Appearance → Pixel effects* or in **customize page**. Animation pauses when your system asks for reduced motion.

### Details
- Follows your Obsidian theme in light and dark. The default *mono* style gives a Notion-like monospace page; switch to *theme native* if you prefer your theme's fonts.
- Transitions respond to what you do (switching tabs, dragging, ticking, opening popups), and all motion turns off if your system asks for reduced motion.
- Live updates as you edit notes. Works on desktop and mobile.

---

## Install

### Manual (until it's in the community store)

1. Download `main.js`, `manifest.json` and `styles.css` from the latest release (or build them, see [Development](#development)).
2. Create the folder `<your vault>/.obsidian/plugins/second-brain-dashboard/` and put the three files in it.
3. In Obsidian: **Settings → Community plugins** → turn off Restricted mode if needed → enable **joejoe's second brain**.

### With BRAT

Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin, choose *Add beta plugin*, and paste this repository's URL.

### From source

```bash
npm install
npm run build
npm run deploy -- "/path/to/YourVault"
```

---

## Getting started

1. Click the **dashboard** icon in the left ribbon, or run **joejoe's second brain: Open dashboard**.
2. Open **Settings → joejoe's second brain** and tell it where things are:
   - **Projects:** a folder (default `Projects/`), a tag (default `#project`), or a frontmatter field (default `type: project`).
   - **Daily notes:** uses the core Daily Notes plugin's folder and format when that plugin is on; otherwise set them here. Habit ticks are saved in daily notes, so this matters.
   - **Excluded folders:** templates, attachments, Excalidraw drawings and so on.
3. Open **Tasks** and pick (or create) the Kanban board to use.
4. Add a few habits in **Trackers → Manage habits**, and hover the top of Home to set an icon and a cover.

To see everything filled in first, open the bundled `demo-vault/` folder as a vault (it has projects, six weeks of habit data, books, meetings and tasks in every supported syntax).

---

## How your notes map to the dashboard

### Tasks

Plain Markdown checkboxes, compatible with the **Tasks** and **Dataview** plugins (neither is required):

```markdown
- [ ] Send invoice #urgent #needs-to-be-done [[Client A]] ⏫ 📅 2026-10-20
- [/] Draft spec [due:: 2026-10-22] [priority:: high]
- [?] Waiting on hosting quote #waiting-on-someone
- [x] Kickoff meeting ✅ 2026-10-13
```

| What | How |
|---|---|
| Status | `[ ]` to do · `[/]` in progress · `[?]` waiting · `[x]` done · `[-]` cancelled (the characters can be changed in settings) |
| Priority | `🔺` P1 urgent · `⏫` P2 high · *(none)* P3 normal · `🔽` P4 low. Also `#p1`–`#p4` or `[priority:: high]` |
| Due date | `📅 YYYY-MM-DD` or `[due:: YYYY-MM-DD]`. Scheduled: `⏳ YYYY-MM-DD` |
| Labels | Any `#tag` on the task. Pick them from the label list or create new ones; colors are set in settings |
| Project | A `[[link]]` to a project note, a task inside the project note or its folder, or `project: [[X]]` in the note's frontmatter |

**Urgent** means P1, `#urgent`, overdue, or due within the *auto-urgent window* (2 days by default).

### Projects

A note is a project if it has `type: project`, has a `#project` tag, sits directly in the project folder, or is a folder note (`Projects/X/X.md`). Plain subfolders of the project folder also count. Optional frontmatter:

```yaml
---
type: project
status: active        # done / archived / cancelled hides it from "active"
area: Work
deadline: 2026-10-30
description: |-
  Refresh the marketing site before the Q4 campaign.
  - New homepage and pricing page
---
```

### Habits

Each habit is a yes/no property in your daily notes:

```yaml
---
gym: true
read: true
meditate: false
---
```

You never have to type these yourself; ticking a box on the dashboard writes them.

### Calendar items

- **Meetings and dated notes:** `date: 2026-10-21` plus an optional `time: "14:30"` in frontmatter.
- **Note deadlines:** `deadline:` or `due:` in frontmatter.

### Other trackers

| Source | Example | Good for |
|---|---|---|
| Daily notes | `weight: 80` in frontmatter, or `sleep:: 7.5` in the body | anything measured once a day |
| One note per item | `Books/Deep Work.md` with `status: finished`, `rating: 4`, `finished: 2026-04-03` | books, job applications, clients |
| Table in a note | `Trackers/Expenses.md` with a `\| date \| amount \| category \|` table | quick logs |

---

## Settings

| Section | What you can set |
|---|---|
| General | Open the dashboard on startup, default task view, week start, excluded folders |
| Appearance | Style (mono or theme native), dark mode surfaces (theme default, darker, plain or black), pixel effects (pixel field, dissolve transitions, pixel size, palette), page title, icon, cover image, quotes, which widgets show, countdown target |
| Quick links | Label, icon, color and target for each link (or leave empty to use your top-level folders) |
| Projects | Project folder, tag and frontmatter field |
| Daily notes & capture | Use the core Daily Notes settings, daily folder and date format, inbox file, where quick capture saves |
| Tasks | Auto-urgent window, deadline window, status characters |
| Labels | Names and colors |
| Secrets vault | File location (default outside the vault), auto-lock minutes, clipboard clear seconds |

Most appearance options can also be changed straight from the dashboard (hover the page header or use **customize page**).

---

## Commands

| Command | |
|---|---|
| Open dashboard | Opens Home |
| Open inbox / tasks board / calendar / projects / notes / trackers / weekly review / library (A–Z) | Opens that tab |
| New fleeting / literature / permanent note | Creates a note from the template |
| Quick capture | Opens the capture window from anywhere |
| Rebuild index | Re-reads the whole vault |
| Open secrets vault / Lock secrets vault | Opens the encrypted secrets manager, or locks it right away |

Assign hotkeys under **Settings → Hotkeys** (search "joejoe").

---

## Development

Requires Node 18+.

```bash
npm install
npm run dev -- "/path/to/YourVault"   # rebuild + copy into the vault on every save; the plugin reloads itself
npm run build      # type-check + production bundle → main.js
npm test           # unit tests for task parsing, board files, stats, calendar logic
npm run deploy -- "/path/to/YourVault"   # copy main.js, manifest.json, styles.css into the vault
```

### Preview without Obsidian

The dashboard can render in a browser against `demo-vault/` through a small Obsidian API shim. This is handy for checking layout changes and taking screenshots:

```bash
npm run preview                                 # → preview/out/index.html
node preview/screenshot.mjs shots home=home "cal=calendar&day=1" "habits=trackers&theme=light"
```

URL hash options: the tab name (`home`, `tasks`, `calendar`, `projects`, `trackers`, `library`), `theme=light`, `mode=week|timeline`, `project=<path>`, `focus=<habit key>`, `capture=1`, `day=1`, `drag=1`.

### Auto-reload while developing
With **Settings → Development → Auto-reload on update** on (the default), the plugin watches its own `main.js`, `styles.css` and `manifest.json`. When they change, for example after `npm run deploy` or during `npm run dev -- "<vault>"`, it reloads itself within a couple of seconds, with no Obsidian restart.

### Releasing

1. Bump `version` in `manifest.json` and `package.json`, and add the version → `minAppVersion` pair to `versions.json`.
2. `npm run build`
3. Create a GitHub release whose tag is exactly the version (e.g. `0.1.0`), and attach `main.js`, `manifest.json` and `styles.css`.

---

## Project structure

```
src/
  main.ts              plugin entry: settings, commands, view registration
  settings.ts          settings model, defaults, settings tab
  types.ts             Task / Project / Note types
  data/
    indexer.ts         vault index: tasks, projects, notes (live updates)
    taskParser.ts      parse and edit Markdown task lines (pure, tested)
    taskWriter.ts      write task changes back safely
    queries.ts         urgency, sorting, deadlines, project stats
    calendar.ts        calendar items and month grids
    kanbanBoard.ts     read/edit Kanban plugin board files (pure, tested)
    trackerTypes.ts    tracker definitions and statistics (pure, tested)
    trackerStore.ts    read and write tracker entries and habit checks
    graph.ts           orphans, link suggestions, resurfacing, splitting (pure, tested)
    ledger.ts          money ledger: parse/edit monthly tables, quick entry, month summary (pure, tested)
    ledgerStore.ts     read and write the monthly ledger notes
    daily.ts           daily-note config, create, append
  view/
    DashboardView.ts   the full-page view and tab routing
    homeTab.ts  tasksTab.ts  kanban.ts  calendarTab.ts  dayModal.ts
    projectsTab.ts  trackersTab.ts  habits.ts  libraryTab.ts
    CaptureModal.ts  widgets.ts  homeEdit.ts  pickers.ts  labels.ts
    inboxTab.ts  notesTab.ts  reviewTab.ts  moneyView.ts  coursesTab.ts  cover.ts  coverControls.ts
    charts.ts  components.ts  trackerModals.ts  dither.ts
  secrets/
    crypto.ts          AES-GCM + PBKDF2 envelope, entry helpers (pure, tested)
    store.ts           encrypted file I/O, unlock session, auto-lock, clipboard clear (tested)
    SecretsModal.ts    setup / lock screen and the two-pane manager
  devReload.ts         reloads the plugin when its files change
styles.css             all styling (theme variables, light and dark)
theme/Joejoe Gallery/  companion Obsidian theme (theme.css + manifest.json)
preview/               browser preview + screenshot script
test/                  unit tests
demo-vault/            sample vault
```

---

## Roadmap

- [x] Core dashboard, Kanban plugin board + task list, priorities and labels, projects, quick capture
- [x] Calendar (month/week/timeline) and the day popup
- [x] Habits with statistics, other trackers, the A–Z library
- [x] Inbox triage and Zettelkasten tools (fleeting → literature → permanent notes, orphans, link suggestions, resurfacing, splitting)
- [x] Weekly review page
- [x] Eisenhower matrix view and saved filters
- [x] Auto-reload during development
- [ ] Optional calendar sync and "ask my notes" (these need outside accounts or API keys)

---

## License

[MIT](LICENSE) © eieien
