"use client";

import { deleteArticle } from "@/app/admin/blog/actions";

export function DeleteArticle({ id }: { id: string }) {
  return (
    <form
      action={deleteArticle}
      onSubmit={(event) => {
        if (!window.confirm("Delete this article? This cannot be undone.")) event.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button className="inline-flex min-h-12 items-center font-semibold text-danger">Delete</button>
    </form>
  );
}
