export interface Http2Session {
  sessionId: string;
  backendId: string;
  lastStreamId: number;
  activeStreamsCount: number;
  isGoawaySent: boolean;
  sendGoawayFrame(lastStreamId: number): void;
  close(): void;
}

export class AdaptiveDrainManager {
  private activeSessions = new Map<string, Http2Session[]>();

  registerSession(backendId: string, session: Http2Session): void {
    const sessions = this.activeSessions.get(backendId) ?? [];
    sessions.push(session);
    this.activeSessions.set(backendId, sessions);
  }

  // Gracefully drain a backend and trigger GOAWAY connection migration
  beginDrain(backendId: string): void {
    const sessions = this.activeSessions.get(backendId);
    if (!sessions || sessions.length === 0) {
      return;
    }

    console.log(`[DRAIN] Beginning graceful connection migration for backend ${backendId}`);

    for (const session of sessions) {
      if (!session.isGoawaySent) {
        // Inject GOAWAY frame with the last stream ID processed.
        session.sendGoawayFrame(session.lastStreamId);
        session.isGoawaySent = true;
        console.log(`[DRAIN] Sent GOAWAY to session ${session.sessionId} with last-stream-id ${session.lastStreamId}`);
      }
    }
  }

  // Check and clean up sessions that have completed all their active streams
  checkDrainStatus(backendId: string): boolean {
    const sessions = this.activeSessions.get(backendId);
    if (!sessions || sessions.length === 0) {
      return true; // Drained
    }

    const remainingSessions = sessions.filter((session) => {
      if (session.activeStreamsCount === 0) {
        session.close();
        console.log(`[DRAIN] Session ${session.sessionId} on backend ${backendId} successfully closed after active streams finished`);
        return false;
      }
      return true;
    });

    this.activeSessions.set(backendId, remainingSessions);
    return remainingSessions.length === 0;
  }
}
