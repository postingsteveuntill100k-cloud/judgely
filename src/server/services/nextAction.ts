import { db } from '../db/index.js';
import type { EventState } from './events.js';
import type { ProgressSnapshot } from './judging.js';

export interface NextAction {
  label: string;
  href: string;
  why: string;
  urgency: 'blocking' | 'soon' | 'normal';
}

const STEP_ORDER = ['basics', 'dates', 'prizes', 'teams', 'tracks', 'submission', 'judging', 'rules', 'branding', 'publish'];

/**
 * "What should I do next?"
 *
 * An organizer running an event should never have to infer the next step from
 * the database. This is the single function that decides it, and the overview
 * page renders whatever it returns. One answer, ranked, not a wall of metrics.
 */
export async function suggestNext(input: {
  event: any;
  state: EventState;
  progress: ProgressSnapshot;
  blockers: string[];
  projectCounts: Record<string, number>;
}): Promise<NextAction | null> {
  const { event, state, progress, blockers, projectCounts } = input;
  const d = db();
  const slug = event.slug;
  const inSetup = event.status === 'draft';

  if (inSetup) {
    if (blockers.length) {
      const map: Record<string, string> = {
        'add a name': 'basics',
        'set a submission deadline': 'dates',
        'write a description of at least 40 characters': 'basics',
        'add at least one track': 'tracks',
        'create a judging rubric': 'judging',
        'add at least one rubric criterion': 'judging',
        'make the rubric weights add up to 100': 'judging',
        'set a start date': 'dates',
      };
      const first = blockers[0];
      const step = map[first] ?? 'basics';
      return {
        label: `Finish setup: ${first}`,
        href: `/host/events/${slug}/setup/${step}`,
        why: `${blockers.length} ${blockers.length === 1 ? 'thing is' : 'things are'} still missing before this hackathon can be published.`,
        urgency: 'blocking',
      };
    }
    return {
      label: 'Publish the hackathon',
      href: `/host/events/${slug}/setup/publish`,
      why: 'Setup is complete. Publishing makes the event page public and opens registration.',
      urgency: 'soon',
    };
  }

  const judges = await d.listEventJudges(event.id);
  const activeJudges = judges.filter((j) => j.status === 'active');
  const tracks = await d.listTracks(event.id);

  if (state.submissions === 'open' && tracks.length && !state.canRegister) {
    return {
      label: 'Registration is closed — submissions are still open',
      href: `/host/events/${slug}/settings`,
      why: 'Participants can still submit but can no longer register. Extend the registration window if that was not intended.',
      urgency: 'soon',
    };
  }

  if (state.submissions === 'open' && progress.submittedProjects === 0) {
    if (!event.public_listing) {
      return {
        label: 'List the hackathon publicly',
        href: `/host/events/${slug}/settings`,
        why: 'Registration is open but the event is unlisted, so nobody can find it. The link works, discovery does not.',
        urgency: 'soon',
      };
    }
    return {
      label: 'Invite judges before the deadline',
      href: `/host/events/${slug}/judges`,
      why: 'Nobody has submitted yet. Inviting judges now means judging can start the moment submissions close.',
      urgency: 'normal',
    };
  }

  if (activeJudges.length === 0) {
    return {
      label: 'Invite judges',
      href: `/host/events/${slug}/judges`,
      why: progress.submittedProjects > 0
        ? `${progress.submittedProjects} ${progress.submittedProjects === 1 ? 'project has' : 'projects have'} been submitted and there is no active judge to review them.`
        : 'There is no active judge on this event yet.',
      urgency: 'blocking',
    };
  }

  if (progress.submittedProjects > 0 && progress.assignments === 0) {
    return {
      label: 'Assign judges to the submitted projects',
      href: `/host/events/${slug}/assignments`,
      why: `${progress.submittedProjects} ${progress.submittedProjects === 1 ? 'project is' : 'projects are'} waiting and nothing has been assigned yet. Auto-assign spreads the load evenly.`,
      urgency: 'blocking',
    };
  }

  const incompleteJudges = progress.perJudge.filter((j) => j.status === 'active' && j.assigned > 0 && j.done < j.assigned);
  if (incompleteJudges.length) {
    return {
      label: `Chase ${incompleteJudges.length} ${incompleteJudges.length === 1 ? 'judge' : 'judges'} with unfinished work`,
      href: `/host/events/${slug}/judging`,
      why: incompleteJudges
        .slice(0, 3)
        .map((j) => `${j.name || j.email} (${j.done}/${j.assigned})`)
        .join(', '),
      urgency: 'normal',
    };
  }

  const uncovered = progress.perProject.filter((p) => p.judges === 0);
  if (uncovered.length) {
    return {
      label: `Assign ${uncovered.length} uncovered ${uncovered.length === 1 ? 'project' : 'projects'}`,
      href: `/host/events/${slug}/assignments`,
      why: 'Some submitted projects have no judge at all, so they cannot be ranked fairly.',
      urgency: 'blocking',
    };
  }

  if (progress.assignments > 0 && progress.submittedReviews === progress.assignments) {
    const results = await d.listResults(event.id, false);
    if (!results.length) {
      return {
        label: 'Compute the results',
        href: `/host/events/${slug}/results`,
        why: `All ${progress.submittedReviews} reviews are in. Computing the ranking takes a moment and does not publish anything yet.`,
        urgency: 'soon',
      };
    }
    if (event.results_visibility !== 'public') {
      return {
        label: 'Review and publish the results',
        href: `/host/events/${slug}/results`,
        why: 'The ranking is computed and private. Publishing makes it visible on the public event page.',
        urgency: 'soon',
      };
    }
    return {
      label: 'Results are live',
      href: `/hackathons/${slug}/results`,
      why: 'Participants can see the published ranking and their project’s place in it.',
      urgency: 'normal',
    };
  }

  if (state.submissions === 'open') {
    const drafts = projectCounts.draft ?? 0;
    if (drafts > 0) {
      return {
        label: `${drafts} ${drafts === 1 ? 'team is' : 'teams are'} still working on a draft`,
        href: `/host/events/${slug}/projects`,
        why: `Submissions close ${new Date(event.submission_deadline).toUTCString()}. A draft is not a submission.`,
        urgency: 'normal',
      };
    }
    return {
      label: 'Wait for submissions to close',
      href: `/host/events/${slug}/projects`,
      why: `Everything is on track. Submissions close ${new Date(event.submission_deadline).toUTCString()}.`,
      urgency: 'normal',
    };
  }

  return null;
}

export { STEP_ORDER };
