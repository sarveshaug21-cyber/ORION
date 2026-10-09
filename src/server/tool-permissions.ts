export type PermissionDecision = 'approved' | 'denied' | 'expired' | 'disconnected';

interface PendingPermission {
  sessionId: string;
  owner: object;
  resolve: (decision: PermissionDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ToolPermissionManager {
  private readonly pending = new Map<string, PendingPermission>();

  constructor(private readonly timeoutMs = 120_000) {}

  request(toolCallId: string, sessionId: string, owner: object): Promise<PermissionDecision> {
    if (this.pending.has(toolCallId)) {
      throw new Error('A permission request already exists for this tool call.');
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => this.finish(toolCallId, 'expired'), this.timeoutMs);
      this.pending.set(toolCallId, { sessionId, owner, resolve, timer });
    });
  }

  respond(
    toolCallId: string,
    sessionId: string,
    owner: object,
    granted: boolean
  ): boolean {
    const request = this.pending.get(toolCallId);
    if (!request || request.sessionId !== sessionId || request.owner !== owner) return false;
    this.finish(toolCallId, granted ? 'approved' : 'denied');
    return true;
  }

  cancelOwner(owner: object): void {
    for (const [toolCallId, request] of this.pending) {
      if (request.owner === owner) this.finish(toolCallId, 'disconnected');
    }
  }

  private finish(toolCallId: string, decision: PermissionDecision): void {
    const request = this.pending.get(toolCallId);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(toolCallId);
    request.resolve(decision);
  }
}
