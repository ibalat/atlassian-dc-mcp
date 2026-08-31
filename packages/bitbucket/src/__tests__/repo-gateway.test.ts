import {
  DECLINE_POLICY,
  MERGE_POLICY,
  assertRepoOperationAllowed,
  assertTargetRefMergeAllowed,
  resolveDeclineGateway,
  resolveMergeGateway,
  type RepoGateway,
} from '../repo-gateway.js';

const silentWarn = () => undefined;

const disabled = (policy = MERGE_POLICY): RepoGateway => ({
  enabled: false,
  repos: [],
  targetRefs: [],
  policy,
});

describe('resolveMergeGateway', () => {
  it('is disabled by default', () => {
    const gateway = resolveMergeGateway({ env: {}, warn: silentWarn });
    expect(gateway.enabled).toBe(false);
    expect(gateway.repos).toEqual([]);
  });

  it('stays disabled when enabled without any repository', () => {
    const gateway = resolveMergeGateway({ env: { BITBUCKET_MERGE_ENABLED: 'true' }, warn: silentWarn });
    expect(gateway.enabled).toBe(false);
  });

  it('stays disabled when every configured repository entry is malformed', () => {
    const gateway = resolveMergeGateway({
      env: { BITBUCKET_MERGE_ENABLED: 'true', BITBUCKET_MERGE_ALLOWED_REPOS: 'demo, PROJ/a/b, */*' },
      warn: silentWarn,
    });
    expect(gateway.enabled).toBe(false);
  });

  it('normalizes repository entries and de-duplicates them', () => {
    const gateway = resolveMergeGateway({
      env: {
        BITBUCKET_MERGE_ENABLED: 'yes',
        BITBUCKET_MERGE_ALLOWED_REPOS: 'proj/Demo, PROJ/demo; OTHER/*',
      },
      warn: silentWarn,
    });
    expect(gateway.enabled).toBe(true);
    expect(gateway.repos).toEqual(['PROJ/demo', 'OTHER/*']);
    expect(gateway.targetRefs).toEqual([]);
  });

  it('expands bare branch names into fully-qualified target refs', () => {
    const gateway = resolveMergeGateway({
      env: {
        BITBUCKET_MERGE_ENABLED: '1',
        BITBUCKET_MERGE_ALLOWED_REPOS: 'PROJ/demo',
        BITBUCKET_MERGE_ALLOWED_TARGET_REFS: 'develop, refs/heads/release/*',
      },
      warn: silentWarn,
    });
    expect(gateway.targetRefs).toEqual(['refs/heads/develop', 'refs/heads/release/*']);
  });

  it('warns about ignored entries and about being enabled with no valid repository', () => {
    const warnings: string[] = [];
    resolveMergeGateway({
      env: { BITBUCKET_MERGE_ENABLED: 'true', BITBUCKET_MERGE_ALLOWED_REPOS: 'demo' },
      warn: message => warnings.push(message),
    });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('"demo"');
    expect(warnings[1]).toContain('stay disabled');
  });
});

describe('resolveDeclineGateway', () => {
  it('is disabled by default', () => {
    const gateway = resolveDeclineGateway({ env: {}, warn: silentWarn });
    expect(gateway.enabled).toBe(false);
  });

  it('reads its own environment variables rather than the merge ones', () => {
    const gateway = resolveDeclineGateway({
      env: {
        BITBUCKET_DECLINE_ENABLED: 'true',
        BITBUCKET_DECLINE_ALLOWED_REPOS: 'proj/Demo, OTHER/*',
      },
      warn: silentWarn,
    });
    expect(gateway.enabled).toBe(true);
    expect(gateway.repos).toEqual(['PROJ/demo', 'OTHER/*']);
  });

  it('stays disabled when only merging was enabled', () => {
    const gateway = resolveDeclineGateway({
      env: { BITBUCKET_MERGE_ENABLED: 'true', BITBUCKET_MERGE_ALLOWED_REPOS: 'PROJ/demo' },
      warn: silentWarn,
    });
    expect(gateway.enabled).toBe(false);
  });

  it('never restricts target refs, even when the merge target refs are configured', () => {
    const gateway = resolveDeclineGateway({
      env: {
        BITBUCKET_DECLINE_ENABLED: 'true',
        BITBUCKET_DECLINE_ALLOWED_REPOS: 'PROJ/demo',
        BITBUCKET_MERGE_ALLOWED_TARGET_REFS: 'develop',
      },
      warn: silentWarn,
    });
    expect(gateway.targetRefs).toEqual([]);
  });

  it('names the decline environment variables when enabled with no valid repository', () => {
    const warnings: string[] = [];
    resolveDeclineGateway({ env: { BITBUCKET_DECLINE_ENABLED: 'true' }, warn: message => warnings.push(message) });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('BITBUCKET_DECLINE_ALLOWED_REPOS');
  });
});

describe('assertRepoOperationAllowed', () => {
  const gateway = resolveMergeGateway({
    env: { BITBUCKET_MERGE_ENABLED: 'true', BITBUCKET_MERGE_ALLOWED_REPOS: 'PROJ/demo, OTHER/*' },
    warn: silentWarn,
  });

  it('refuses everything when the operation is disabled', () => {
    expect(() => assertRepoOperationAllowed(disabled(), 'PROJ', 'demo'))
      .toThrow(/disabled on this server/);
  });

  it('names the environment variables of its own operation when disabled', () => {
    expect(() => assertRepoOperationAllowed(disabled(DECLINE_POLICY), 'PROJ', 'demo'))
      .toThrow(/Declining pull requests is disabled on this server\. Enable it with BITBUCKET_DECLINE_ENABLED and list the allowed repositories in BITBUCKET_DECLINE_ALLOWED_REPOS\./);
  });

  it('allows an exact repository regardless of the casing used by the caller', () => {
    expect(() => assertRepoOperationAllowed(gateway, 'proj', 'DEMO')).not.toThrow();
  });

  it('allows any repository in a wildcard project', () => {
    expect(() => assertRepoOperationAllowed(gateway, 'OTHER', 'anything')).not.toThrow();
  });

  it('refuses a repository outside the allowed list', () => {
    expect(() => assertRepoOperationAllowed(gateway, 'PROJ', 'other-repo')).toThrow(/Merging is not allowed in PROJ\/other-repo/);
  });

  it('names the refused operation in the message', () => {
    const declineGateway = resolveDeclineGateway({
      env: { BITBUCKET_DECLINE_ENABLED: 'true', BITBUCKET_DECLINE_ALLOWED_REPOS: 'PROJ/demo' },
      warn: silentWarn,
    });
    expect(() => assertRepoOperationAllowed(declineGateway, 'PROJ', 'other-repo'))
      .toThrow(/Declining is not allowed in PROJ\/other-repo/);
  });

  it('does not treat a wildcard project as a prefix of another project', () => {
    expect(() => assertRepoOperationAllowed(gateway, 'OTHERS', 'demo')).toThrow(/not allowed/);
  });
});

describe('assertTargetRefMergeAllowed', () => {
  const unrestricted: RepoGateway = { enabled: true, repos: ['PROJ/demo'], targetRefs: [], policy: MERGE_POLICY };
  const restricted: RepoGateway = {
    enabled: true,
    repos: ['PROJ/demo'],
    targetRefs: ['refs/heads/develop', 'refs/heads/release/*'],
    policy: MERGE_POLICY,
  };

  it('allows any ref when no target-ref restriction is configured', () => {
    expect(() => assertTargetRefMergeAllowed(unrestricted, 'refs/heads/master')).not.toThrow();
    expect(() => assertTargetRefMergeAllowed(unrestricted, undefined)).not.toThrow();
  });

  it('allows an exact and a wildcard target ref', () => {
    expect(() => assertTargetRefMergeAllowed(restricted, 'refs/heads/develop')).not.toThrow();
    expect(() => assertTargetRefMergeAllowed(restricted, 'refs/heads/release/1.2')).not.toThrow();
  });

  it('refuses a target ref outside the allowed list', () => {
    expect(() => assertTargetRefMergeAllowed(restricted, 'refs/heads/master')).toThrow(/refs\/heads\/master is not allowed/);
  });

  it('refuses when the target ref is unknown but restrictions apply', () => {
    expect(() => assertTargetRefMergeAllowed(restricted, undefined)).toThrow(/Could not determine the target branch/);
  });
});
