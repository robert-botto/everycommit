// Minimal GitHub GraphQL client: one function, retries, timeouts. No dependencies.

const ENDPOINT = 'https://api.github.com/graphql';

export function createClient(token, { fetchImpl = fetch, retries = 2, timeoutMs = 60_000 } = {}) {
  if (!token) throw new Error('A GitHub token is required');
  return async function graphql(query, variables = {}) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'everycommit',
          },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await response.text();
        let body;
        try { body = JSON.parse(text); } catch { throw new Error(`GitHub returned HTTP ${response.status} (not JSON)`); }
        if (!response.ok || body.errors) {
          throw new Error(`GitHub GraphQL failed: ${JSON.stringify(body.errors ?? body)}`);
        }
        return body.data;
      } catch (error) {
        if (attempt >= retries) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
      }
    }
  };
}

export const VIEWER = `query { viewer { login databaseId } }`;

// The account's own email list, with GitHub's verified flag. Needs the classic scope user:email, or
// the fine-grained account permission "Email addresses: read".
export async function fetchEmails(token, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl('https://api.github.com/user/emails?per_page=100', {
    headers: { Authorization: `bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'everycommit' },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new Error('this token cannot read its account email addresses. Grant the user:email scope ' +
      '(gh auth refresh -s user:email) or, for a fine-grained token, the account permission "Email addresses: read"');
  }
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status} for /user/emails`);
  return (await response.json()).map(({ email, verified }) => ({ email, verified }));
}

export const CALENDAR = `query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) { contributionsCollection(from: $from, to: $to) {
    contributionCalendar { weeks { contributionDays { date contributionCount } } } } } }`;

export const REPOS = `query($cursor: String) { viewer { repositories(first: 100, after: $cursor,
  orderBy: { field: PUSHED_AT, direction: DESC },
  affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER],
  ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]) {
    pageInfo { hasNextPage endCursor } nodes { nameWithOwner pushedAt createdAt } } } }`;

const COMMIT_FIELDS = `oid authoredDate committedDate additions deletions changedFilesIfAvailable
  parents { totalCount } author { email user { login } }`;

export const BRANCH_COMMITS = `query($owner: String!, $name: String!, $since: GitTimestamp!, $cursor: String, $refs: Int!, $size: Int!) {
  repository(owner: $owner, name: $name) { refs(refPrefix: "refs/heads/", first: $refs, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { name target { ... on Commit { history(first: $size, since: $since) {
      pageInfo { hasNextPage endCursor } nodes { ${COMMIT_FIELDS} } } } } } } } }`;

export const MORE_COMMITS = `query($owner: String!, $name: String!, $ref: String!, $since: GitTimestamp!, $cursor: String, $size: Int!) {
  repository(owner: $owner, name: $name) { ref(qualifiedName: $ref) { target { ... on Commit {
    history(first: $size, after: $cursor, since: $since) {
      pageInfo { hasNextPage endCursor } nodes { ${COMMIT_FIELDS} } } } } } } }`;

export const MERGED_PRS = `query($q: String!) { search(query: $q, type: ISSUE, first: 1) { issueCount } }`;
