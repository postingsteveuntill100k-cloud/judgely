import { wrapRouter } from './safe.js';
import { Router } from 'express';
import { db } from '../db/index.js';
import { page, strParam } from './helpers.js';
import { acceptInvitation } from '../services/invites.js';
import { requireAuth } from '../middleware/session.js';
import { safeNext } from './auth.js';
import { AppError } from '../lib/errors.js';

export function inviteRoutes(): Router {
  const r = Router();

  r.get('/invite/:token', async (req, res, next) => {
    const d = db();
    const invitation = await d.getInvitationByToken(req.params.token);
    if (!invitation) {
      return page(res, 'invite/invalid', req, {
        pageTitle: 'Invitation not found',
        reason: 'This link is not a valid judging invitation. Ask the organizer to send a new one.',
      }, 404);
    }
    const event = await d.getEventById(invitation.event_id);
    const status = invitation.status;
    if (status !== 'sent') {
      return page(res, 'invite/invalid', req, {
        pageTitle: 'Invitation already used',
        reason:
          status === 'accepted'
            ? 'This invitation has already been accepted. Sign in to see your assignments.'
            : status === 'revoked'
              ? 'The organizer withdrew this invitation.'
              : 'This invitation is no longer active.',
        event,
        signedIn: Boolean(req.actor),
      }, 410);
    }
    if (!event) {
      return page(res, 'invite/invalid', req, { pageTitle: 'Hackathon not found', reason: 'The hackathon this invitation refers to no longer exists.' }, 404);
    }
    const judge = await d.getEventJudgeByEmail(event.id, invitation.email);
    const signedInAs = req.actor;
    const emailMatches = signedInAs && String(signedInAs.email).toLowerCase() === invitation.email_lower;
    await page(res, 'invite/accept', req, {
      pageTitle: `Judge ${event.name}`,
      event,
      invitation,
      judge,
      signedIn: Boolean(signedInAs),
      emailMatches: Boolean(emailMatches),
      signinNext: `/invite/${req.params.token}`,
    });
    void next;
  });

  r.post('/invite/:token', requireAuth, async (req, res, next) => {
    try {
      const { event } = await acceptInvitation(req.params.token, req.actor);
      res.redirect(303, `/judge/events/${event.slug}`);
    } catch (e) {
      const err = e as AppError;
      const invitation = await db().getInvitationByToken(req.params.token);
      const event = invitation ? await db().getEventById(invitation.event_id) : null;
      return page(res, 'invite/invalid', req, {
        pageTitle: 'Could not accept the invitation',
        reason: err.message,
        event,
        signedIn: true,
        status: err.status,
        signinNext: `/invite/${strParam(req.params.token, 200)}`,
      }, err.status);
    }
  });

  return wrapRouter(r);
}

export { safeNext };
