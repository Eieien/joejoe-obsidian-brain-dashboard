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

### Library
![Library](docs/screenshots/library.png)
- An A–Z index of every note, grouped under letter headers with divider lines and with folder, type and date in aligned columns. Sorted by recent, it groups by month instead.
- Filter by folder (including subfolders), type, tag or area. The letter rail jumps between groups.
- Three views: large index, notebook list, and cards.

### Quick capture
![Quick capture](docs/screenshots/capture.png)
- Every field visible at once: title, task or note, priority, due date (date field plus Today / Tomorrow / Next week), labels with an inline *new label* field, project, and where to save (today's note, Inbox, or the project's note).
- Open it from the **capture** button, the command palette, or a hotkey you assign.

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
| Appearance | Style (mono or theme native), dark mode surfaces (theme default, darker, plain or black), page title, icon, cover image, quotes, which widgets show, countdown target |
| Quick links | Label, icon, color and target for each link (or leave empty to use your top-level folders) |
| Projects | Project folder, tag and frontmatter field |
| Daily notes & capture | Use the core Daily Notes settings, daily folder and date format, inbox file, where quick capture saves |
| Tasks | Auto-urgent window, deadline window, status characters |
| Labels | Names and colors |

Most appearance options can also be changed straight from the dashboard (hover the page header or use **customize page**).

---

## Commands

| Command | |
|---|---|
| Open dashboard | Opens Home |
| Open tasks board / calendar / projects / trackers / library (A–Z) | Opens that tab |
| Quick capture | Opens the capture window from anywhere |
| Rebuild index | Re-reads the whole vault |

Assign hotkeys under **Settings → Hotkeys** (search "joejoe").

---

## Development

Requires Node 18+.

```bash
npm install
npm run dev        # rebuild on change (pair with the Hot Reload plugin)
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
    daily.ts           daily-note config, create, append
  view/
    DashboardView.ts   the full-page view and tab routing
    homeTab.ts  tasksTab.ts  kanban.ts  calendarTab.ts  dayModal.ts
    projectsTab.ts  trackersTab.ts  habits.ts  libraryTab.ts
    CaptureModal.ts  widgets.ts  homeEdit.ts  pickers.ts  labels.ts
    charts.ts  components.ts  trackerModals.ts
styles.css             all styling (theme variables, light and dark)
preview/               browser preview + screenshot script
test/                  unit tests
demo-vault/            sample vault
```

---

## Roadmap

- [x] Core dashboard, Kanban plugin board + task list, priorities and labels, projects, quick capture
- [x] Calendar (month/week/timeline) and the day popup
- [x] Habits with statistics, other trackers, the A–Z library
- [ ] Inbox triage and Zettelkasten tools (fleeting → literature → permanent notes, orphans, resurfacing)
- [ ] Weekly review page
- [ ] Eisenhower matrix view and saved filters
- [ ] Optional calendar sync and "ask my notes"

---

## License

[MIT](LICENSE) © eieien
