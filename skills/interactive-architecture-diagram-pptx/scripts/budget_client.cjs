function createRemoteBudgetAdapter(client, { groupId, attemptTokenLimit = 192000, groupTokenLimit = null }) {
  let initialized = groupTokenLimit === null;
  async function call(action, payload) {
    const response = await client.request("/view-groups/budget", {
      action,
      group_id: groupId,
      ...payload,
    });
    if (response?.status === "error") throw new Error(response.error?.message || response.error?.code || "budget action failed");
    return response;
  }
  return {
    remote: true,
    async reserve({ attempt_id, token_limit }) {
      const response = await call("reserve", {
        attempt_id,
        tokens: token_limit || attemptTokenLimit,
        ...(initialized ? {} : { group_token_limit: groupTokenLimit }),
      });
      initialized = true;
      return { ...response.result, snapshot: response.snapshot };
    },
    async settle(attemptId, usage) {
      const response = await call("settle", { attempt_id: attemptId, usage });
      return { ...response.result, snapshot: response.snapshot };
    },
    async release(attemptId) {
      const response = await call("release", { attempt_id: attemptId });
      return { ...response.result, snapshot: response.snapshot };
    },
    async reconcile(attemptId, usage) {
      const response = await call("reconcile", { attempt_id: attemptId, usage });
      return { ...response.result, snapshot: response.snapshot };
    },
    async snapshot() {
      const response = await call("snapshot", {});
      return response.snapshot;
    },
  };
}

module.exports = { createRemoteBudgetAdapter };
