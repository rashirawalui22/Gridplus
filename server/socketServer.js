export function attachSocketHandlers(io, auth, engine) {
  const pendingSockets = new Set();
  const invalidatedSockets = new WeakSet();

  io.use((socket, next) => {
    if (!auth.status.enabled) return next();
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string' || !token) return next(new Error('Authentication is required.'));

    let claims;
    try {
      claims = auth.verifyToken(token);
    } catch (error) {
      return next(new Error(error.status && error.status < 500 ? error.message : 'Authentication could not be verified.'));
    }

    socket.data.pendingIdentity = { userId: String(claims.sub), tokenId: claims.jti };
    pendingSockets.add(socket);
    auth.authenticateToken(token).then((user) => {
      if (invalidatedSockets.has(socket)) {
        const error = new Error('The access token has been revoked.');
        error.status = 401;
        pendingSockets.delete(socket);
        delete socket.data.pendingIdentity;
        return next(error);
      }
      socket.data.user = user;
      return next();
    }, (error) => {
      pendingSockets.delete(socket);
      delete socket.data.pendingIdentity;
      return next(new Error(error.status && error.status < 500 ? error.message : 'Authentication could not be verified.'));
    });
  });

  const invalidateSessions = (identity) => {
    const matchesIdentity = (candidate) => (
      Boolean(identity.tokenId && candidate?.tokenId === identity.tokenId)
      || Boolean(identity.userId && candidate?.userId === identity.userId)
    );
    for (const socket of pendingSockets) {
      if (matchesIdentity(socket.data.pendingIdentity)) {
        invalidatedSockets.add(socket);
        pendingSockets.delete(socket);
        socket.disconnect(true);
      }
    }
    for (const socket of io.sockets.sockets.values()) {
      if (matchesIdentity(socket.data.user)) socket.disconnect(true);
    }
  };
  const unsubscribe = auth.onSessionInvalidated(invalidateSessions);

  const onSnapshot = (snapshot) => io.emit('telemetry:snapshot', snapshot);
  const onStatus = (status) => io.emit('simulation:status', status);
  const onAlerts = (alerts) => io.emit('alerts:update', alerts);
  const onConnection = (socket) => {
    pendingSockets.delete(socket);
    delete socket.data.pendingIdentity;
    if (invalidatedSockets.has(socket)) {
      socket.disconnect(true);
      return;
    }
    const expiresAt = socket.data.user?.tokenExpiresAt;
    if (expiresAt) {
      const expiryTimer = setTimeout(() => socket.disconnect(true), Math.max(0, expiresAt * 1000 - Date.now()));
      expiryTimer.unref?.();
      socket.once('disconnect', () => clearTimeout(expiryTimer));
    }
    socket.emit('telemetry:snapshot', engine.getSnapshot());
    socket.emit('simulation:status', engine.getStatus());
  };

  engine.on('snapshot', onSnapshot);
  engine.on('status', onStatus);
  engine.on('alerts', onAlerts);
  io.on('connection', onConnection);

  return () => {
    unsubscribe();
    engine.off('snapshot', onSnapshot);
    engine.off('status', onStatus);
    engine.off('alerts', onAlerts);
    io.off('connection', onConnection);
  };
}
