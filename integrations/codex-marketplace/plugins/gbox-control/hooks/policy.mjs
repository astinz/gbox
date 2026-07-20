export function shouldForwardStop(status) {
  return status?.globalObservation === true;
}
