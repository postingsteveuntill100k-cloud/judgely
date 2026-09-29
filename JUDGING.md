# Judging

How Hackerly turns a panel of judges clicking buttons into a ranking, and
exactly what it refuses to do along the way.

Everything here is deterministic. The same reviews produce the same ranking, in
the same order, on any machine. There is no randomness anywhere in the
pipeline, and no hidden tie-break that a judge cannot see.

---

## 1. The rubric

A hackathon's rubric is a list of criteria, each with:

| Field        | Meaning                                                        |
| ------------ | -------------------------------------------------------------- |
| `name`       | What is being judged                                            |
| `description`| The sentence a judge reads before scoring                        |
| `weight`     | How much this criterion counts, relative to the others           |
| `max_score`  | The top of the scale for this criterion (not always 10)         |
| `required`   | Whether a judge may submit without scoring it                    |

Weights are validated when an organizer saves them: they must be positive and
must total 100. A client cannot invent a criterion, change a weight, or remove
a required one — the rubric is written by
`services/judging.ts` on the server, and the review form is rendered from the
stored rubric, not from anything the browser sends.

**Versions.** Saving a rubric creates a new version and leaves the old one in
place. Reviews already submitted stay attached to the criteria and weights that
were in force when they were submitted. An organizer who edits a rubric
mid-judging therefore does not retroactively change what the panel already
scored — the results page says so, in the version list, rather than silently
re-weighting old work.

---

## 2. One review

A review is one judge, one project, scored against the rubric that was active
when they opened it.

`saveReview` refuses a submission that:

- contains a score for a criterion that is not in the rubric
- omits a criterion marked `required`
- has a score outside `0 … max_score` for that criterion
- carries a `judge_id` or `judge_email` supplied by the request

That last one matters. The judge is taken **from the session**, never from the
request body, so a judge cannot file a review under somebody else's name even
by editing the form. The review is additionally required to belong to an
assignment whose `event_judge_id` matches the session, so a judge cannot score a
project they were not given.

Rubric validation is in `src/server/services/judging.ts`; the per-review
weighted score is recomputed from the stored criterion scores every time results
are computed, rather than being cached at submission time. Editing a score
therefore cannot produce a stale total.

---

## 3. From reviews to a project score

### Step 1 — review score, 0–100

Each criterion score is expressed as a fraction of that criterion's maximum,
weighted, and divided by the total weight:

```
review = 100 × Σ (score_c / max_c × weight_c) / Σ weight_c
```

Using `max_c` rather than assuming every scale is 0–10 means a rubric with a
0–5 criterion and a 0–10 criterion still produces a score out of 100.

### Step 2 — project score

A project's score is the **mean of its submitted review scores**. Projects with
no submitted reviews are excluded from the ranking entirely and listed
separately, rather than being given a zero that would drag down the projects
that were actually judged.

### Step 3 — panel offset (only in `normalized` mode)

Judges differ. Some are consistently harsh, some generous. Normalization
measures each judge's bias against the panel and removes part of it:

```
offset_j  = mean(score_j) − mean(all scores)
adjusted  = score + λ × (−offset_j)
```

`λ` (lambda) is the organizer's setting from 0 to 1:

- `λ = 0` — nothing is removed; the adjustment is a no-op.
- `λ = 0.5` — half of a judge's measured bias is removed.
- `λ = 1` — the judge's entire measured offset is removed.

`λ = 0` removes nothing at all, which is why the help text says so next to the
field. The organizer sees each judge's offset on the judging page before
deciding, because a number that silently changes a ranking should be visible
first.

### Step 4 — normalization inside each track

Adjusted scores are min–max scaled within each track, so a track whose rubric
ran hot does not dominate a track that ran cold:

```
final = 100 × (adjusted − min(track)) / (max(track) − min(track))
```

**Tracks smaller than five scored projects are not scaled.** With two projects,
scaling guarantees the winner gets 100 and the loser gets 0, which says nothing
about quality — it just restates the ordering. Below
`MIN_TRACK_SIZE_FOR_SCALING` (= 5) Hackerly keeps the adjusted 0–100 score,
which already came from the rubric, and records a diagnostic saying so. The
diagnostics are printed on the organizer's results page; a ranking whose
method was quietly simplified is not something to hide.

If every project in a track has the same score, the spread is zero and they
share a rank rather than dividing by zero.

### Step 5 — ranking

Competition ranking ("1224"): equal scores share a rank and the next rank skips
accordingly. Ties are broken deterministically, in this order:

1. higher adjusted score
2. more submitted reviews
3. earlier first submission
4. project title, then id

The last two are arbitrary and total — they exist only so the order is stable
across runs, never to favour anything.

---

## 4. Publishing, and what becomes visible

Computing and publishing are separate actions, and that separation is the point.

- **Compute** writes a private ranking. Nothing public changes. The organizer
  can compute repeatedly while judging is still going in.
- **Publish** sets `published_at` on the results rows, and only then does the
  public event page show a ranking.
- **Withdraw publication** clears it again, and the public page goes back to
  saying results are not out.

At no point does an individual judge's score become public. The public results
page shows the project, its track, its rank and its final score. The
per-criterion, per-judge breakdown is visible only to organizers of that event,
and is in the CSV export. A judge sees their own scores and nobody else's —
enforced in `routes/judge.ts` and in `/api/judge/scores`, not in a template.

---

## 5. What this method is not

It is a defensible, documented, deterministic aggregation. It is **not** a
validated claim that it produces better or fairer outcomes than any other
method. Normalization in particular is a known-contested idea: removing a
judge's measured harshness also removes the signal that they are a harsh
judge, and with a small panel the panel mean is itself unstable. That is why
`λ` is a visible organizer setting with a documented range and not a hidden
default, why the raw and adjusted scores are both stored, and why both are
shown side by side on the results page.

If your hackathon needs pairwise comparison, live scoring, or conflict-of-interest
exclusion, this is not the tool for it. Hackerly does what it does and tells you
what it did.
