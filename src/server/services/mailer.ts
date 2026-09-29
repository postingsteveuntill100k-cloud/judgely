import { config } from '../config.js';
import { log } from '../lib/logger.js';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Invitation delivery.
 *
 * MAIL_MODE=log  -> the message is written to data/outbox/ and shown to the
 *                   organizer in the judge list. Nothing pretends to be sent.
 * MAIL_MODE=smtp -> a real SMTP conversation using node:net + node:tls.
 *                   No third-party SDK, no outbound dependency when unused.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface DeliveryResult {
  mode: 'log' | 'smtp';
  delivered: boolean;
  detail: string;
}

export async function deliver(message: MailMessage): Promise<DeliveryResult> {
  if (config.mail.mode === 'smtp' && config.mail.smtpHost) {
    try {
      await sendSmtp(message);
      log.info('invitation delivered', { to: message.to, transport: 'smtp' });
      return { mode: 'smtp', delivered: true, detail: `Delivered to ${message.to} via ${config.mail.smtpHost}` };
    } catch (e) {
      const detail = `SMTP delivery failed: ${(e as Error).message}`;
      log.error(detail, { to: message.to });
      writeToOutbox(message, detail);
      return { mode: 'smtp', delivered: false, detail };
    }
  }
  const detail = `No mail provider configured. The invitation is stored and the link is shown in the judge list. (MAIL_MODE=${config.mail.mode})`;
  writeToOutbox(message, detail);
  return { mode: 'log', delivered: false, detail };
}

function writeToOutbox(message: MailMessage, note: string): void {
  try {
    const dir = path.join(config.dataDir, 'outbox');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${message.to.replace(/[^a-z0-9@._-]/gi, '_')}.txt`);
    appendFileSync(
      file,
      [
        `To: ${message.to}`,
        `Subject: ${message.subject}`,
        `Date: ${new Date().toISOString()}`,
        `Note: ${note}`,
        '',
        message.text,
        '',
      ].join('\n'),
    );
    log.info('invitation written to outbox', { to: message.to, file: path.basename(file) });
  } catch (e) {
    log.warn('could not write outbox', { error: (e as Error).message });
  }
}

async function sendSmtp(message: MailMessage): Promise<void> {
  const net = await import('node:net');
  const tls = await import('node:tls');
  const port = config.mail.smtpPort;
  const useTls = port === 465;

  const socket: any = await Promise.resolve(useTls
    ? tls.connect({ host: config.mail.smtpHost, port, servername: config.mail.smtpHost })
    : net.connect({ host: config.mail.smtpHost, port })
  ).catch((e: any) => {
    throw new Error(`cannot reach ${config.mail.smtpHost}:${port} (${e.message})`);
  });

  return new Promise((resolve, reject) => {
    let buffer = '';
    const steps: string[] = [];
    const fromAddr = config.mail.from.match(/<([^>]+)>/)?.[1] ?? config.mail.from;
    steps.push(`EHLO ${config.baseUrl.replace(/^https?:\/\//, '').split(':')[0] || 'localhost'}`);
    if (config.mail.smtpUser) {
      steps.push('AUTH LOGIN');
      steps.push(Buffer.from(config.mail.smtpUser).toString('base64'));
      steps.push(Buffer.from(config.mail.smtpPass).toString('base64'));
    }
    steps.push(`MAIL FROM:<${fromAddr}>`);
    steps.push(`RCPT TO:<${message.to}>`);
    steps.push('DATA');
    steps.push(
      [
        `From: ${config.mail.from}`,
        `To: ${message.to}`,
        `Subject: ${message.subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        message.text,
      ].join('\r\n'),
    );
    steps.push('.');
    steps.push('QUIT');

    let step = -1;
    let inData = false;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('SMTP timeout'));
    }, 15000);

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      if (!/\r\n$/.test(buffer)) return;
      const lines = buffer.split(/\r\n/).filter(Boolean);
      buffer = '';
      const last = lines[lines.length - 1];
      const code = Number.parseInt(last.slice(0, 3), 10);
      if (Number.isNaN(code) || code >= 400) {
        clearTimeout(timer);
        socket.destroy();
        return reject(new Error(`SMTP server replied: ${last}`));
      }
      if (code === 354) {
        step += 1;
        socket.write(steps[step] + '\r\n');
        return;
      }
      step += 1;
      if (step >= steps.length) {
        clearTimeout(timer);
        socket.end();
        return resolve();
      }
      socket.write(steps[step] + '\r\n');
      void inData;
    };

    socket.on('data', onData);
    socket.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    socket.on('close', () => {
      clearTimeout(timer);
    });
  });
}
