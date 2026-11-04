// Decides whether a commit is verifiably yours.
//
// A commit is verified only when both hold:
//   1. GitHub linked its author to an account you proved with that account's own token
//      (commit.author.user.login), and
//   2. its author email is one that account has VERIFIED on GitHub, or that account's own noreply
//      address.
// The second check matters because GitHub links a commit to any account that has merely added the
// email, without proof of the mailbox. Without it, someone could add a stranger's unclaimed email,
// fork the stranger's repository, and collect their commits.
//
// Everything else that still looks like you (an email you list yourself, an unverified email, an
// old noreply address GitHub no longer links) only ever lands in the separate self-reported total.

const NOREPLY = /^(?:(\d+)\+)?([^@]+)@users\.noreply\.github\.com$/i;

// accounts: [{ login, id, verifiedEmails: string[] }]
export function createIdentity({ accounts, selfReportedEmails = [] }) {
  const byLogin = new Map(accounts.map((account) => [account.login.toLowerCase(), {
    id: account.id == null ? null : String(account.id),
    verified: new Set((account.verifiedEmails ?? []).map((email) => email.toLowerCase())),
  }]));
  const listed = new Set(selfReportedEmails.map((email) => email.trim().toLowerCase()).filter(Boolean));

  const ownNoreply = (email, login, account) => {
    const match = email.match(NOREPLY);
    if (!match || match[2].toLowerCase() !== login) return false;
    return match[1] === undefined || account.id === null || match[1] === account.id;
  };

  return function classify(author) {
    const email = (author?.email ?? '').toLowerCase();
    const linked = author?.user?.login?.toLowerCase();
    if (linked) {
      const account = byLogin.get(linked);
      if (!account) return 'other';
      return account.verified.has(email) || ownNoreply(email, linked, account) ? 'verified' : 'self-reported';
    }
    if (listed.has(email)) return 'self-reported';
    const match = email.match(NOREPLY);
    if (match && byLogin.has(match[2].toLowerCase())) return 'self-reported';
    return 'other';
  };
}
