export const runtimeState = {
  pendingUserSend: false,
  lastUserSendAt: 0,
};

export function markUserSend() {
  runtimeState.pendingUserSend = true;
  runtimeState.lastUserSendAt = Date.now();
}

export function consumeUserSendFlag() {
  runtimeState.pendingUserSend = false;
}
