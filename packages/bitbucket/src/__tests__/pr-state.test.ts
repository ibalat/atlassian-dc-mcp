import { PullRequestsService } from '../bitbucket-client/index.js';
import { declinePullRequest, reopenPullRequest } from '../pr-state.js';
import { DECLINE_POLICY, type RepoGateway } from '../repo-gateway.js';

jest.mock('../bitbucket-client/index.js', () => ({
  PullRequestsService: {
    decline: jest.fn(),
    reopen: jest.fn(),
  },
  OpenAPI: { BASE: '', TOKEN: '', VERSION: '' },
}));

const decline = PullRequestsService.decline as jest.Mock;
const reopen = PullRequestsService.reopen as jest.Mock;

const OPEN_GATEWAY: RepoGateway = {
  enabled: true,
  repos: ['PROJ/demo'],
  targetRefs: [],
  policy: DECLINE_POLICY,
};

const DECLINED_PR = {
  id: 42,
  version: 3,
  title: 'Add decline tool',
  state: 'DECLINED',
  fromRef: { id: 'refs/heads/feature' },
  toRef: { id: 'refs/heads/develop' },
  reviewers: [],
};

const REOPENED_PR = { ...DECLINED_PR, version: 4, state: 'OPEN' };

const baseParams = {
  projectKey: 'PROJ',
  repositorySlug: 'demo',
  pullRequestId: '42',
  version: 2,
};

describe('declinePullRequest', () => {
  beforeEach(() => jest.clearAllMocks());

  it('declines with the version as an optimistic lock and returns a compact ack', async () => {
    decline.mockResolvedValue(DECLINED_PR);

    const result = await declinePullRequest({ ...baseParams, gateway: OPEN_GATEWAY });

    expect(decline).toHaveBeenCalledWith('PROJ', '42', 'demo', '2', { version: 2 });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      id: 42,
      version: 3,
      title: 'Add decline tool',
      state: 'DECLINED',
      fromRefId: 'refs/heads/feature',
      toRefId: 'refs/heads/develop',
      reviewerCount: 0,
    });
  });

  it('posts the reason atomically with the decline when a comment is given', async () => {
    decline.mockResolvedValue(DECLINED_PR);

    await declinePullRequest({
      ...baseParams,
      gateway: OPEN_GATEWAY,
      comment: 'Superseded by PR 99.',
    });

    expect(decline).toHaveBeenCalledWith('PROJ', '42', 'demo', '2', {
      version: 2,
      comment: 'Superseded by PR 99.',
    });
  });

  it('can return the full payload', async () => {
    decline.mockResolvedValue(DECLINED_PR);

    const result = await declinePullRequest({ ...baseParams, gateway: OPEN_GATEWAY, output: 'full' });

    expect(result.data).toBe(DECLINED_PR);
  });

  it('refuses without any request when declining is disabled', async () => {
    const result = await declinePullRequest({
      ...baseParams,
      gateway: { enabled: false, repos: [], targetRefs: [], policy: DECLINE_POLICY },
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Declining pull requests is disabled on this server/);
    expect(decline).not.toHaveBeenCalled();
  });

  it('refuses a repository outside the allowed list without any request', async () => {
    const result = await declinePullRequest({
      ...baseParams,
      repositorySlug: 'other-repo',
      gateway: OPEN_GATEWAY,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Declining is not allowed in PROJ\/other-repo/);
    expect(decline).not.toHaveBeenCalled();
  });

  it('surfaces a server-side failure such as a stale version', async () => {
    decline.mockRejectedValue({ status: 409, statusText: 'Conflict', body: { errors: [{ message: 'stale' }] } });

    const result = await declinePullRequest({ ...baseParams, gateway: OPEN_GATEWAY });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Error declining pull request: 409 Conflict');
    expect(result.details).toEqual({ errors: [{ message: 'stale' }] });
  });
});

describe('reopenPullRequest', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reopens with the version as an optimistic lock and returns a compact ack', async () => {
    reopen.mockResolvedValue(REOPENED_PR);

    const result = await reopenPullRequest(baseParams);

    expect(reopen).toHaveBeenCalledWith('PROJ', '42', 'demo', '2', { version: 2 });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ id: 42, version: 4, state: 'OPEN' });
  });

  it('can return the full payload', async () => {
    reopen.mockResolvedValue(REOPENED_PR);

    const result = await reopenPullRequest({ ...baseParams, output: 'full' });

    expect(result.data).toBe(REOPENED_PR);
  });

  it('surfaces a server-side failure such as a pull request that is not declined', async () => {
    reopen.mockRejectedValue({ status: 409, statusText: 'Conflict', body: { errors: [{ message: 'not declined' }] } });

    const result = await reopenPullRequest(baseParams);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Error reopening pull request: 409 Conflict');
    expect(result.details).toEqual({ errors: [{ message: 'not declined' }] });
  });
});
