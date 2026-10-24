import { hideReview, submitReview } from "@/app/jobs/review-actions";
import { createClient } from "@/lib/supabase/server";

type ReviewRow = {
  id: string;
  reviewer_id: string;
  reviewer_role: string;
  stars: number;
  body: string | null;
  hidden_at: string | null;
};

export async function ReviewPanel({
  jobId,
  userId,
  nextPath,
  canModerate,
}: {
  jobId: string;
  userId: string;
  nextPath: string;
  canModerate?: boolean;
}) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_reviews")
    .select("id, reviewer_id, reviewer_role, stars, body, hidden_at")
    .eq("job_id", jobId);
  const reviews = (data ?? []) as ReviewRow[];
  const mine = reviews.find((review) => review.reviewer_id === userId);
  const others = reviews.filter((review) => review.reviewer_id !== userId);

  return (
    <section className="mx-auto mt-6 w-full max-w-xl px-4">
      <h2 className="text-lg font-semibold text-ink">Review</h2>
      <p className="mt-1 text-base text-muted">
        Your review stays hidden until the other person reviews, or for 14 days after the job is completed.
      </p>
      {mine ? (
        <p className="mt-3 text-base text-ink">
          You gave {mine.stars} stars.{mine.body ? ` ${mine.body}` : ""}
          {mine.hidden_at ? " An admin hid this review. The words were not changed." : ""}
        </p>
      ) : (
        <form action={submitReview} className="mt-3 grid gap-3">
          <input type="hidden" name="jobId" value={jobId} />
          <input type="hidden" name="next" value={nextPath} />
          <label className="text-base font-semibold text-ink">
            Stars
            <select name="stars" required className="mt-1 min-h-12 w-full rounded-2xl border border-line px-3">
              <option value="5">5</option>
              <option value="4">4</option>
              <option value="3">3</option>
              <option value="2">2</option>
              <option value="1">1</option>
            </select>
          </label>
          <label className="text-base font-semibold text-ink">
            Comment, optional
            <textarea name="note" maxLength={1000} className="mt-1 min-h-24 w-full rounded-2xl border border-line px-3 py-2" />
          </label>
          <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-white">
            Send review
          </button>
        </form>
      )}
      {others.map((review) => (
        <p key={review.id} className="mt-3 text-base text-ink">
          {review.reviewer_role === "driver" ? "Driver" : "Customer"} gave {review.stars} stars.
          {review.body ? ` ${review.body}` : ""}
          {review.hidden_at ? " Hidden." : ""}
        </p>
      ))}
      {canModerate
        ? reviews
            .filter((review) => !review.hidden_at)
            .map((review) => (
              <form key={`hide-${review.id}`} action={hideReview} className="mt-2">
                <input type="hidden" name="reviewId" value={review.id} />
                <input type="hidden" name="next" value={nextPath} />
                <button type="submit" className="font-semibold text-brand">
                  Hide this review
                </button>
              </form>
            ))
        : null}
    </section>
  );
}
