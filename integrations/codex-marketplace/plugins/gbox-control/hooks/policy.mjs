export function shouldForwardStop(status) {
  return status?.globalObservation === true;
}

export function stableStopPayload(input) {
  return {
    session_id: input?.session_id,
    turn_id: input?.turn_id,
    cwd: input?.cwd,
    last_assistant_message: input?.last_assistant_message,
  };
}
