/**
 * Storage contract.
 *
 * Hackerly has two drivers:
 *   sqlite     — the canonical, self-hostable store. One file, no server, no network.
 *   firestore  — used for Global mode when the deployment is on Google Cloud
 *                (Firebase Hosting + Cloud Functions). Enabled by DB_DRIVER=firestore.
 *
 * Every driver implements the same domain-level operations, so a route handler
 * never learns which one it is talking to. Authorization lives in the services
 * above this layer, never here.
 */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
}

export interface Driver {
  readonly name: 'sqlite' | 'firestore';
  init(): Promise<void>;
  close(): Promise<void>;
  health(): Promise<{ ok: boolean; driver: string; detail: string }>;

  // identity
  createUser(u: Record<string, unknown>): Promise<any>;
  getUserById(id: string): Promise<any | null>;
  getUserByEmail(email: string): Promise<any | null>;
  getUserByUsername(username: string): Promise<any | null>;
  getUserByFirebaseUid(uid: string): Promise<any | null>;
  updateUser(id: string, patch: Record<string, unknown>): Promise<any | null>;
  countUsers(): Promise<number>;
  listUsers(limit?: number, offset?: number): Promise<any[]>;

  // sessions
  createSession(s: Record<string, unknown>): Promise<void>;
  getSessionByTokenHash(h: string): Promise<any | null>;
  touchSession(id: string, seenAt: string): Promise<void>;
  deleteSession(id: string): Promise<void>;
  deleteSessionsForUser(userId: string): Promise<void>;
  purgeExpiredSessions(beforeIso: string): Promise<number>;
  listSessions(userId: string): Promise<any[]>;

  // login throttling persistence
  recordLoginAttempt(a: Record<string, unknown>): Promise<void>;
  countRecentLoginFailures(identifier: string, sinceIso: string): Promise<number>;

  // events
  createEvent(e: Record<string, unknown>): Promise<any>;
  updateEvent(id: string, patch: Record<string, unknown>): Promise<any | null>;
  getEventById(id: string): Promise<any | null>;
  getEventBySlug(slug: string): Promise<any | null>;
  listEvents(opts: { status?: string[]; listing?: boolean; q?: string; limit?: number; offset?: number; order?: string }): Promise<{ rows: any[]; total: number }>;
  countEventsByStatus(): Promise<Record<string, number>>;
  addOrganizer(eventId: string, userId: string, role: string, at: string): Promise<void>;
  removeOrganizer(eventId: string, userId: string): Promise<void>;
  listOrganizers(eventId: string): Promise<any[]>;
  isOrganizer(eventId: string, userId: string): Promise<boolean>;
  getEventOrganizer(eventId: string, userId: string): Promise<any | null>;
  listEventsForOrganizer(userId: string, limit?: number, offset?: number): Promise<{ rows: any[]; total: number }>;

  // membership
  addMember(eventId: string, userId: string, role: string, at: string): Promise<void>;
  removeMember(eventId: string, userId: string, role: string): Promise<void>;
  getMembership(eventId: string, userId: string, role?: string): Promise<any | null>;
  listMemberEvents(userId: string, role?: string): Promise<any[]>;
  listEventMembers(eventId: string, role?: string): Promise<any[]>;

  // announcements
  createAnnouncement(a: Record<string, unknown>): Promise<any>;
  listAnnouncements(eventId: string, limit: number): Promise<any[]>;
  deleteAnnouncement(id: string): Promise<void>;

  // tracks
  createTrack(t: Record<string, unknown>): Promise<any>;
  updateTrack(id: string, patch: Record<string, unknown>): Promise<any | null>;
  deleteTrack(id: string): Promise<void>;
  getTrack(id: string): Promise<any | null>;
  getTrackBySlug(eventId: string, slug: string): Promise<any | null>;
  listTracks(eventId: string): Promise<any[]>;

  // teams
  createTeam(t: Record<string, unknown>): Promise<any>;
  updateTeam(id: string, patch: Record<string, unknown>): Promise<any | null>;
  getTeam(id: string): Promise<any | null>;
  getTeamBySlug(eventId: string, slug: string): Promise<any | null>;
  deleteTeam(id: string): Promise<void>;
  listTeams(eventId: string, opts: { q?: string; limit?: number; offset?: number }): Promise<{ rows: any[]; total: number }>;
  listTeamsForUser(userId: string): Promise<any[]>;
  addTeamMember(teamId: string, userId: string, role: string, at: string): Promise<void>;
  removeTeamMember(teamId: string, userId: string): Promise<void>;
  getTeamMember(teamId: string, userId: string): Promise<any | null>;
  listTeamMembers(teamId: string): Promise<any[]>;
  countTeamMembers(teamId: string): Promise<number>;

  // projects
  createProject(p: Record<string, unknown>): Promise<any>;
  updateProject(id: string, patch: Record<string, unknown>): Promise<any | null>;
  getProject(id: string): Promise<any | null>;
  getProjectBySlug(eventId: string, slug: string): Promise<any | null>;
  listProjects(opts: { eventId?: string; trackId?: string; teamId?: string; status?: string[]; q?: string; publicOnly?: boolean; sort?: string; limit?: number; offset?: number }): Promise<{ rows: any[]; total: number }>;
  listProjectsForTeam(teamId: string): Promise<any[]>;
  countProjectsByStatus(eventId: string): Promise<Record<string, number>>;

  // rubrics
  createRubric(r: Record<string, unknown>): Promise<any>;
  getActiveRubric(eventId: string): Promise<any | null>;
  getRubric(id: string): Promise<any | null>;
  listRubrics(eventId: string): Promise<any[]>;
  createCriterion(c: Record<string, unknown>): Promise<any>;
  updateCriterion(id: string, patch: Record<string, unknown>): Promise<any | null>;
  deleteCriterion(id: string): Promise<void>;
  getCriterion(id: string): Promise<any | null>;
  listCriteria(rubricId: string): Promise<any[]>;
  archiveRubric(id: string, at?: string): Promise<void>;

  // judges
  createEventJudge(j: Record<string, unknown>): Promise<any>;
  getEventJudge(id: string): Promise<any | null>;
  getEventJudgeByEmail(eventId: string, email: string): Promise<any | null>;
  getEventJudgeForUser(eventId: string, userId: string): Promise<any | null>;
  updateEventJudge(id: string, patch: Record<string, unknown>): Promise<any | null>;
  listEventJudges(eventId: string, opts?: { status?: string }): Promise<any[]>;
  listJudgeEvents(userId: string): Promise<any[]>;

  // assignments
  createAssignment(a: Record<string, unknown>): Promise<any>;
  updateAssignment(id: string, patch: Record<string, unknown>): Promise<any | null>;
  getAssignment(id: string): Promise<any | null>;
  deleteAssignment(id: string): Promise<void>;
  listAssignments(opts: { eventId?: string; judgeId?: string; projectId?: string; status?: string[]; limit?: number; offset?: number }): Promise<{ rows: any[]; total: number }>;
  countAssignmentsByStatus(eventId: string): Promise<Record<string, number>>;
  listAssignmentProjectIds(judgeId: string): Promise<string[]>;

  // reviews
  createReview(r: Record<string, unknown>): Promise<any>;
  updateReview(id: string, patch: Record<string, unknown>): Promise<any | null>;
  getReview(id: string): Promise<any | null>;
  getReviewByAssignment(assignmentId: string): Promise<any | null>;
  listReviews(opts: { eventId?: string; judgeId?: string; userId?: string; projectId?: string; status?: string; limit?: number; offset?: number }): Promise<any[]>;
  countReviews(eventId: string): Promise<{ total: number; submitted: number }>;
  upsertScore(s: Record<string, unknown>): Promise<void>;
  replaceReviewScores(reviewId: string, scores: Record<string, unknown>[]): Promise<void>;
  listScores(reviewId: string): Promise<any[]>;
  listScoresForProject(projectId: string): Promise<any[]>;
  listAllScoresForEvent(eventId: string): Promise<any[]>;

  // results
  replaceResults(eventId: string, rows: Record<string, unknown>[], computedAt: string): Promise<void>;
  listResults(eventId: string, publishedOnly: boolean): Promise<any[]>;
  getResultForProject(eventId: string, projectId: string): Promise<any | null>;
  publishResults(eventId: string, at: string): Promise<void>;
  unpublishResults(eventId: string): Promise<void>;
  addResultPrizes(eventId: string, rows: Record<string, unknown>[]): Promise<void>;
  listResultPrizes(eventId: string): Promise<any[]>;

  // notifications
  createNotification(n: Record<string, unknown>): Promise<void>;
  createNotifications(notifications: Record<string, unknown>[]): Promise<void>;
  listNotifications(userId: string, limit: number): Promise<any[]>;
  countUnread(userId: string): Promise<number>;
  markAllRead(userId: string, at: string): Promise<void>;

  // invitations
  createInvitation(i: Record<string, unknown>): Promise<any>;
  getInvitationByToken(token: string): Promise<any | null>;
  updateInvitation(id: string, patch: Record<string, unknown>): Promise<void>;
  listInvitations(eventId: string): Promise<any[]>;

  // audit
  addAudit(a: Record<string, unknown>): Promise<void>;
  listAudit(eventId: string | null, opts: { limit?: number; offset?: number; action?: string }): Promise<{ rows: any[]; total: number }>;
  countAudit(eventId: string): Promise<number>;

  // public extras
  addVote(projectId: string, userId: string, at: string): Promise<void>;
  removeVote(projectId: string, userId: string): Promise<void>;
  hasVoted(projectId: string, userId: string): Promise<boolean>;
  countVotes(projectId: string): Promise<number>;
  voteCounts(projectIds: string[]): Promise<Record<string, number>>;
  addComment(c: Record<string, unknown>): Promise<any>;
  listComments(projectId: string, limit: number): Promise<any[]>;
  setCommentHidden(id: string, hidden: boolean): Promise<void>;

  // platform stats for the host overview
  platformCounts(): Promise<{ users: number; events: number; projects: number; reviews: number }>;
}
