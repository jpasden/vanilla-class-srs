# Subject Lead Teachers (SLs)

An SL is an existing teacher appointed to oversee one Subject/Grade. Leadership is a scoped permission: the account remains a Teacher, and their access elsewhere stays limited to classes they own. Each Subject/Grade has zero or one SL. The same teacher can lead several Subject/Grades.

## Select or change an SL

1. Sign in as an Admin and open **Subject Grades**.
2. Add the teacher to that Subject/Grade if they are not already a member (Teachers or the group's Batch Ops page).
3. Click **Edit** for the Subject/Grade.
4. Choose **Subject Lead Teacher** from its assigned teachers, then save.
5. Choose **Unassigned** to clear the appointment, or choose another member to replace it.

The list displays names and email addresses. An appointment never silently adds a teacher to a group. With no assigned teachers, the setting explains that membership must be added first. New groups are created unassigned, since they have no teachers yet.

The group list shows its current SL; the Teachers page marks the relevant memberships with **SL**. Before removing an SL's group membership or offboarding them, clear or replace their leadership assignments. Existing restrictions on removing teachers who own classes still apply.

## What the SL sees

**Classes** starts with **My Classes**, followed by **[Subject/Grade] Classes** for every group they lead. Each group section shows all its active classes and their teachers, including the SL's own classes if any. Own classes retain the existing teacher controls. Colleagues' classes open in read-only oversight mode.

**Subject Leadership** provides member-teacher and class overviews, including teachers without classes. Choose **Entire Subject/Grade** or an individual class. The class roster links to student statistics, personal cards, and the full class-enrollment deck.

The SL can read class rosters, assignments, homework, stats, and student card data. They cannot edit colleagues' classes, change rosters or passwords, assign/remove CardSets, set homework, edit other teachers' private libraries, or appoint SLs. Full-deck inspection exposes only cards actually present in the selected student's class deck, with their effective definitions/examples and learning progress.

Leadership is checked from the database on each request. Clearing or replacing an SL takes effect for their next request with the same session. Navigation refreshes on changing pages or returning focus to the browser. Archiving a Subject/Grade or Department suspends oversight access; retained appointments resume when the group is active again.

Admins can access the same reports through **Subject/Grade Reports**, from the Subject Grade name, or from the Classes Overview group headings. The new full-deck view is available to Admins for all active classes and ordinary teachers for their own classes.

## Report definitions

- Reports include current active classes and enrollments only. Removed enrollments and archived classes are excluded, even when their review history remains stored.
- Unique students count people once; active enrollments and detail rows count each class enrollment separately. A student in two classes has two decks and two detail rows.
- Accuracy counts grade 2–4 as correct, divided by all review events in the selected calendar-day lookback. It is weighted by reviews, rather than averaging class or session percentages. No reviews produces an empty percentage rather than 0%.
- Cards reviewed count review events; completed sessions are a distinct metric.
- Activity uses the browser's reporting timezone. Rolling accuracy includes the six preceding days needed to complete each seven-day window.
- Homework is a current snapshot. The denominator includes enrollments in classes with active requirements, applying each class's existing period/session rules. Classes without requirements are reported separately.
- Optional adoption counts active enrollments in classes actually offering that optional set.
- Card statistics retain distinct card IDs even when word text matches. Possessing enrollments are counted currently; accuracy/reviewed counts use the selected lookback.
- Mastery is lifetime data, with separately paginated enrollment rows and card columns. Forecasts show future dates in the current card schedule, with overdue cards counted separately.
- Student Additions has an independent explicit date range; its **To** date is exclusive. It retains the existing sort and CSV export controls.

Students and card/matrix detail sections are paginated server-side. The full-deck inspector offers word search and CardSet/origin/state filters and shows 50 cards per page.

## Deployment and verification

Apply the normal Prisma migration deployment before starting the updated server. The migration `20261004000000_subject_grade_lead` adds the appointment table with a membership foreign key and one-lead-per-group constraint. Existing roles, memberships, decks, and history are unchanged; every group initially has no SL. Generate the Prisma client during the normal build. No existing account needs a new login or role conversion.

The regular server suite includes permission and reporting-boundary unit tests. `subjectLead.integration.test.ts` runs only with `SL_TEST_DATABASE_URL` set to a disposable PostgreSQL database named `sl_fresh` on `127.0.0.1`, with the migration history already applied. It creates synthetic teachers, students, classes and cards; never point it at a real school database. The suite tests real authenticated API routes, scoped reads/writes, revocation, archival, aggregation, pagination, and database constraints.

Implementation verification used PostgreSQL 18 in a disposable local cluster:

- Migration history applied successfully to a fresh database and an existing-data fixture.
- 202 server tests passed, including ten authenticated PostgreSQL integration scenarios.
- Shared, server, and client builds passed.
- Browser checks covered the Admin candidate setting, SL navigation, My Classes/group-class layout, colleague read-only class, and student overrides in the full deck.
- A synthetic group with 5 classes, 50 students, 5,000 card instances and 50,000 review events returned a summary in roughly 0.75 seconds (18 database queries); the summary response was approximately 4.4 KB. A 25-card detail page used 5 queries and roughly 28 ms; a 25-by-25 mastery page used 11 queries and roughly 16 ms. These are local fixture measurements, not production latency guarantees. Homework-intensive groups use the existing per-enrollment compliance calculation.
