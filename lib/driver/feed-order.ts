export type FeedStamp = { id: string; created_at: string };

export function compareNewest(left: FeedStamp, right: FeedStamp): number {
  const byTime = right.created_at.localeCompare(left.created_at);
  if (byTime !== 0) return byTime;
  return left.id.localeCompare(right.id);
}

type KeptCard = { id: string; photos: string[]; schedule?: unknown };

export function mergeFeedCards<T extends KeptCard>(current: T[], incoming: T[]): T[] {
  const previous = new Map(current.map((job) => [job.id, job]));
  return incoming.map((job) => {
    const saved = previous.get(job.id);
    if (!saved) return job;
    return {
      ...job,
      photos: saved.photos.length > 0 ? saved.photos : job.photos,
      schedule: saved.schedule !== undefined ? saved.schedule : job.schedule,
    };
  });
}
