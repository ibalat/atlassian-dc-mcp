/**
 * Operator-controlled gate for pull request operations that change state on a shared branch
 * or in front of other people.
 *
 * A merge cannot be undone through the API, and a decline is visible to every reviewer the
 * moment it lands, so both are disabled by default: the tool is not even registered unless
 * the operator enables it and names the repositories it may act on. Each operation reads its
 * own environment variables, so allowing declines never implies allowing merges. The scope is
 * read once at startup, so the model can never select or widen it. Read-only checks are not
 * gated.
 */

/** Names an operation in refusal messages and points the operator at the variables that open it. */
export interface GatewayPolicy {
  /** Short operation name, used to tag warnings. */
  name: string;
  /** Gerund that starts a refusal message, e.g. "Merging". */
  gerund: string;
  flagVar: string;
  reposVar: string;
  /** Omitted for operations that have no meaningful target-branch restriction. */
  targetRefsVar?: string;
}

export const MERGE_POLICY: GatewayPolicy = {
  name: 'merge',
  gerund: 'Merging',
  flagVar: 'BITBUCKET_MERGE_ENABLED',
  reposVar: 'BITBUCKET_MERGE_ALLOWED_REPOS',
  targetRefsVar: 'BITBUCKET_MERGE_ALLOWED_TARGET_REFS',
};

/**
 * Declining has no target-ref restriction: which branch a pull request would have landed on
 * says nothing about whether abandoning it is safe.
 */
export const DECLINE_POLICY: GatewayPolicy = {
  name: 'decline',
  gerund: 'Declining',
  flagVar: 'BITBUCKET_DECLINE_ENABLED',
  reposVar: 'BITBUCKET_DECLINE_ALLOWED_REPOS',
};

export interface RepoGateway {
  /** Whether the operation is enabled and at least one valid repository pattern resolved. */
  enabled: boolean;
  /** Allowed `PROJECT/repository-slug` targets; a `PROJECT/*` entry allows the whole project. */
  repos: string[];
  /** Allowed target refs; a trailing `*` matches a prefix. Empty means any ref in an allowed repository. */
  targetRefs: string[];
  policy: GatewayPolicy;
}

type Env = Record<string, string | undefined>;
type Warn = (message: string) => void;

export interface ResolveGatewayOptions {
  env?: Env;
  warn?: Warn;
}

const REPO_ENTRY_RE = /^[^\s/]+\/[^\s/]+$/;

function readBool(env: Env, name: string): boolean {
  const value = env[name]?.trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

function parseList(raw: string | undefined): string[] {
  return (raw ?? '').split(/[,;\s]+/).map(entry => entry.trim()).filter(Boolean);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Accepts `PROJECT/repository-slug` or `PROJECT/*`. The project key is upper-cased and
 * the slug lower-cased to match the casing the REST API uses, so comparisons are exact.
 */
function normalizeRepoEntry(entry: string, warn: Warn): string | undefined {
  if (!REPO_ENTRY_RE.test(entry)) {
    warn(`Ignoring repository entry that is not "PROJECT/repository-slug" or "PROJECT/*": "${entry}"`);
    return undefined;
  }
  const [projectKey, slug] = entry.split('/');
  if (projectKey === '*') {
    warn(`Ignoring repository entry that would allow every project: "${entry}"`);
    return undefined;
  }
  return `${projectKey.toUpperCase()}/${slug.toLowerCase()}`;
}

/** Bare branch names are expanded so operators can write `develop` instead of `refs/heads/develop`. */
function normalizeRefEntry(entry: string): string {
  return entry.startsWith('refs/') ? entry : `refs/heads/${entry}`;
}

function matchesPattern(value: string, pattern: string): boolean {
  return pattern.endsWith('*') ? value.startsWith(pattern.slice(0, -1)) : value === pattern;
}

function disabledGateway(policy: GatewayPolicy): RepoGateway {
  return { enabled: false, repos: [], targetRefs: [], policy };
}

/**
 * Reads one operation's gateway configuration from the environment. The operation only
 * activates when its flag is set and at least one repository entry is valid; otherwise a
 * warning is logged and the gateway stays disabled.
 */
export function resolveGateway(policy: GatewayPolicy, options?: ResolveGatewayOptions): RepoGateway {
  const env = options?.env ?? process.env;
  const warn = options?.warn ?? ((message: string) => console.error(`[${policy.name}-gateway] ${message}`));

  if (!readBool(env, policy.flagVar)) {
    return disabledGateway(policy);
  }

  const repos = dedupe(
    parseList(env[policy.reposVar])
      .map(entry => normalizeRepoEntry(entry, warn))
      .filter((entry): entry is string => Boolean(entry)),
  );

  if (repos.length === 0) {
    warn(
      `${policy.gerund} was enabled but no valid repository is configured (set ${policy.reposVar} ` +
        'to a list of "PROJECT/repository-slug" or "PROJECT/*" entries); the tool will stay disabled.',
    );
    return disabledGateway(policy);
  }

  const targetRefs = policy.targetRefsVar
    ? dedupe(parseList(env[policy.targetRefsVar]).map(normalizeRefEntry))
    : [];

  return { enabled: true, repos, targetRefs, policy };
}

export function resolveMergeGateway(options?: ResolveGatewayOptions): RepoGateway {
  return resolveGateway(MERGE_POLICY, options);
}

export function resolveDeclineGateway(options?: ResolveGatewayOptions): RepoGateway {
  return resolveGateway(DECLINE_POLICY, options);
}

/** Throws unless the gateway allows its operation in this repository. No network call. */
export function assertRepoOperationAllowed(gateway: RepoGateway, projectKey: string, repositorySlug: string): void {
  const { policy } = gateway;
  if (!gateway.enabled) {
    throw new Error(
      `${policy.gerund} pull requests is disabled on this server. Enable it with ${policy.flagVar} ` +
        `and list the allowed repositories in ${policy.reposVar}.`,
    );
  }
  const target = `${projectKey.toUpperCase()}/${repositorySlug.toLowerCase()}`;
  if (!gateway.repos.some(pattern => matchesPattern(target, pattern))) {
    throw new Error(
      `${policy.gerund} is not allowed in ${target} on this server. Allowed: ${gateway.repos.join(', ')}.`,
    );
  }
}

/** Throws unless the gateway allows merging into this target ref. A gateway with no ref restriction allows all. */
export function assertTargetRefMergeAllowed(gateway: RepoGateway, targetRefId: string | undefined): void {
  if (gateway.targetRefs.length === 0) {
    return;
  }
  if (!targetRefId) {
    throw new Error(
      'Could not determine the target branch of the pull request, and this server restricts which ' +
        `branches may be merged into (${gateway.policy.targetRefsVar}); refusing to merge.`,
    );
  }
  if (!gateway.targetRefs.some(pattern => matchesPattern(targetRefId, pattern))) {
    throw new Error(
      `Merging into ${targetRefId} is not allowed on this server. ` +
        `Allowed target refs: ${gateway.targetRefs.join(', ')}.`,
    );
  }
}
