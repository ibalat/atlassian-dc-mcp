import { handleApiOperation } from '@atlassian-dc-mcp/common';
import { PullRequestsService } from './bitbucket-client/index.js';
import { BitbucketMutationOutputMode, shapePullRequestAck } from './bitbucket-response-mapper.js';
import { assertRepoOperationAllowed, type RepoGateway } from './repo-gateway.js';

interface PullRequestStateParams {
  projectKey: string;
  repositorySlug: string;
  pullRequestId: string;
  /** Current PR version, required for optimistic locking. */
  version: number;
  output?: BitbucketMutationOutputMode;
}

export interface DeclinePullRequestParams extends PullRequestStateParams {
  gateway: RepoGateway;
  /**
   * Reason for declining, posted as a pull request comment by the same request. Sending it with
   * the decline keeps the two atomic: a rejected decline leaves no orphaned "why this was
   * abandoned" comment on a pull request that stayed open.
   */
  comment?: string;
}

export type ReopenPullRequestParams = PullRequestStateParams;

/** The ack carries the new version, which is what a later reopen needs as its optimistic lock. */
function shapeResult<T extends { success: boolean; data?: unknown }>(result: T, output?: BitbucketMutationOutputMode) {
  if (result.success && result.data && output !== 'full') {
    return { ...result, data: shapePullRequestAck(result.data) };
  }
  return result;
}

/**
 * Decline a pull request under the operator's decline policy. The repository is checked before
 * any request is issued. Bitbucket rejects a stale version and a pull request that is not OPEN
 * with a 409, so no pre-flight read is needed.
 */
export async function declinePullRequest(params: DeclinePullRequestParams) {
  const { projectKey, repositorySlug, pullRequestId, version, gateway, comment } = params;

  const result = await handleApiOperation(async () => {
    assertRepoOperationAllowed(gateway, projectKey, repositorySlug);

    return PullRequestsService.decline(projectKey, pullRequestId, repositorySlug, String(version), {
      version,
      ...(comment ? { comment } : {}),
    });
  }, 'Error declining pull request');

  return shapeResult(result, params.output);
}

/**
 * Reopen a declined pull request. Ungated: it restores the state a decline removed, so it is the
 * undo path rather than a destructive one. A pull request that is not declined is rejected with a 409.
 */
export async function reopenPullRequest(params: ReopenPullRequestParams) {
  const { projectKey, repositorySlug, pullRequestId, version } = params;

  const result = await handleApiOperation(
    () => PullRequestsService.reopen(projectKey, pullRequestId, repositorySlug, String(version), { version }),
    'Error reopening pull request',
  );

  return shapeResult(result, params.output);
}
