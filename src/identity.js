// Decides whether a commit is verifiably yours.
//
// The rule: a commit counts as verified only when GitHub itself has linked its author to one of
// the accounts you proved ownership of with a token (commit.author.user.login). GitHub makes that
// link only when the author email is verified on that account, so nobody can claim commits by
// listing someone else's email. Everything else (an unlinked email you list yourself, or an old
// noreply address GitHub no longer links) can only ever land in the separate self-reported total.

const NOREPLY = /^(?:(\d+)\+)?([^@]+)@users\.noreply\.github\.com$/i;

export function createIdentity({ provenLogins, selfReportedEmails = [] }) {
  const logins = new Set(provenLogins.map((login) => login.toLowerCase()));
  const emails = new Set(selfReportedEmails.map((email) => email.trim().toLowerCase()).filter(Boolean));

  return function classify(author) {
    const linked = author?.user?.login?.toLowerCase();
    if (linked) return logins.has(linked) ? 'verified' : 'other';
    const email = (author?.email ?? '').toLowerCase();
    if (emails.has(email)) return 'self-reported';
    const noreply = email.match(NOREPLY);
    if (noreply && logins.has(noreply[2].toLowerCase())) return 'self-reported';
    return 'other';
  };
}
