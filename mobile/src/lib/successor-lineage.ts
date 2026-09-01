type LineageFrame = {
  id: string;
  subjectRappid: string;
  holoSequence: number;
};

export function mergeSuccessorLineage<T extends LineageFrame>(
  successor: T,
  currentFrames: readonly T[],
  libraryEntries: readonly { holo: T }[],
): T[] {
  const frames = new Map<string, T>();
  for (const frame of [
    ...currentFrames,
    ...libraryEntries.map((entry) => entry.holo),
    successor,
  ]) {
    if (frame.subjectRappid === successor.subjectRappid) {
      frames.set(frame.id, frame);
    }
  }
  return [...frames.values()].sort(
    (left, right) => right.holoSequence - left.holoSequence,
  );
}
