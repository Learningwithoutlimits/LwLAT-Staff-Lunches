// Feedback button -> a GitHub issue on this app's own repository.
// GITHUB_TOKEN: a fine-grained token for this one repo with Issues: read and write only (renew yearly).
// GITHUB_REPO: owner/name. No names or emails go to GitHub: who sent it is kept in the app's change log.
import type { FeedbackKind } from '../../shared/types.ts';
import { APP_NAME } from '../../shared/constants.ts';

export const feedbackOn = () => !!(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO);

const LABEL: Record<FeedbackKind, string> = { bug: 'bug', idea: 'enhancement', question: 'question' };

/** Remove email addresses and long IDs, so nothing personal reaches GitHub by accident. */
export const scrub = (s: string) => s.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]').replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[id]');

export async function createIssue({ kind, message, impact, details, role }:
  { kind: FeedbackKind; message: string; impact?: string; details?: string; role: string }): Promise<number> {
  const title = `${kind === 'bug' ? 'Bug' : kind === 'idea' ? 'Idea' : 'Question'}: ${scrub(message).split('\n')[0].slice(0, 80)}`;
  const body = [scrub(message), '',
    impact ? `**Impact:** ${impact}` : '', `**Sent by:** a ${role} user of ${APP_NAME} (name kept in the app's change log)`,
    details ? `\n<details><summary>Technical details</summary>\n\n\`\`\`\n${scrub(details).slice(0, 4000)}\n\`\`\`\n</details>` : '',
  ].filter(Boolean).join('\n');
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPO}/issues`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28', 'content-type': 'application/json', 'user-agent': 'lwlat-app' },
    body: JSON.stringify({ title, body, labels: [LABEL[kind]] }),
  });
  if (!res.ok) throw Object.assign(new Error(`GitHub refused the issue (${res.status})`), { status: 502 });
  return ((await res.json()) as { number: number }).number;
}
