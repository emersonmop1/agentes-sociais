import { exec, many, one, oneOrThrow, type Queryable } from "../client.js";

export type ReelsStatus =
  | "draft"
  | "hooks_review"
  | "hook_picked"
  | "script_review"
  | "script_approved"
  | "caption_review"
  | "caption_approved"
  | "broll_review"
  | "ready"
  | "rejected";

export interface ReelsHookOption {
  angle: string;        // e.g. "preguiça", "FOMO", "controvérsia"
  hook: string;         // the actual line/visual described
  why: string;          // 1-line rationale
}

export interface ReelsBeat {
  index: number;
  start_seconds: number;
  end_seconds: number;
  visual: string;
  on_camera_speech: string;
  on_screen_text: string;
  broll_hint?: string;
}

export interface ReelsScriptRow {
  id: string;
  company_id: string;
  created_by: string | null;

  status: ReelsStatus;
  title: string;
  theme: string | null;
  target_duration: number;

  hook_options: ReelsHookOption[];
  chosen_hook: string | null;

  beats: ReelsBeat[];

  caption: string | null;
  cta: string | null;
  hashtags: string[];

  broll_suggestions: string[];
  voice_over_script: string | null;
  edit_notes: string | null;

  rejection_feedback: string | null;
  revision_count: number;

  chat_session_id: string | null;

  created_at: string;
  updated_at: string;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────

export async function createReel(
  q: Queryable | undefined,
  args: {
    companyId: string;
    createdBy: string;
    title: string;
    theme?: string;
    targetDuration?: number;
    chatSessionId?: string;
  },
): Promise<ReelsScriptRow> {
  return oneOrThrow<ReelsScriptRow>(
    q,
    `INSERT INTO public.reels_scripts
       (company_id, created_by, title, theme, target_duration, chat_session_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      args.companyId,
      args.createdBy,
      args.title,
      args.theme ?? null,
      args.targetDuration ?? 30,
      args.chatSessionId ?? null,
    ],
  );
}

export async function getReelById(
  q: Queryable | undefined,
  id: string,
  companyId: string,
): Promise<ReelsScriptRow | null> {
  return one<ReelsScriptRow>(
    q,
    `SELECT * FROM public.reels_scripts WHERE id = $1 AND company_id = $2`,
    [id, companyId],
  );
}

export async function listReels(
  q: Queryable | undefined,
  args: { companyId: string; status?: ReelsStatus; limit?: number },
): Promise<ReelsScriptRow[]> {
  const conds: string[] = [`company_id = $1`];
  const vals: unknown[] = [args.companyId];
  if (args.status) {
    conds.push(`status = $${vals.length + 1}::public.reels_script_status`);
    vals.push(args.status);
  }
  vals.push(args.limit ?? 100);
  return many<ReelsScriptRow>(
    q,
    `SELECT * FROM public.reels_scripts
      WHERE ${conds.join(" AND ")}
      ORDER BY updated_at DESC LIMIT $${vals.length}`,
    vals as never,
  );
}

export async function updateHookOptions(
  q: Queryable | undefined,
  args: { id: string; companyId: string; hooks: ReelsHookOption[] },
): Promise<ReelsScriptRow> {
  return oneOrThrow<ReelsScriptRow>(
    q,
    `UPDATE public.reels_scripts
        SET hook_options = $3::jsonb, updated_at = now()
      WHERE id = $1 AND company_id = $2 RETURNING *`,
    [args.id, args.companyId, JSON.stringify(args.hooks)],
  );
}

export async function updateChosenHook(
  q: Queryable | undefined,
  args: { id: string; companyId: string; hook: string },
): Promise<ReelsScriptRow> {
  return oneOrThrow<ReelsScriptRow>(
    q,
    `UPDATE public.reels_scripts
        SET chosen_hook = $3, updated_at = now()
      WHERE id = $1 AND company_id = $2 RETURNING *`,
    [args.id, args.companyId, args.hook],
  );
}

export async function updateBeats(
  q: Queryable | undefined,
  args: { id: string; companyId: string; beats: ReelsBeat[] },
): Promise<ReelsScriptRow> {
  return oneOrThrow<ReelsScriptRow>(
    q,
    `UPDATE public.reels_scripts
        SET beats = $3::jsonb, updated_at = now()
      WHERE id = $1 AND company_id = $2 RETURNING *`,
    [args.id, args.companyId, JSON.stringify(args.beats)],
  );
}

export async function updateCaption(
  q: Queryable | undefined,
  args: {
    id: string;
    companyId: string;
    caption: string;
    cta: string | null;
    hashtags: string[];
  },
): Promise<ReelsScriptRow> {
  return oneOrThrow<ReelsScriptRow>(
    q,
    `UPDATE public.reels_scripts
        SET caption = $3, cta = $4, hashtags = $5, updated_at = now()
      WHERE id = $1 AND company_id = $2 RETURNING *`,
    [args.id, args.companyId, args.caption, args.cta, args.hashtags],
  );
}

export async function updateBroll(
  q: Queryable | undefined,
  args: {
    id: string;
    companyId: string;
    broll_suggestions: string[];
    voice_over_script: string | null;
    edit_notes: string | null;
  },
): Promise<ReelsScriptRow> {
  return oneOrThrow<ReelsScriptRow>(
    q,
    `UPDATE public.reels_scripts
        SET broll_suggestions = $3,
            voice_over_script = $4,
            edit_notes = $5,
            updated_at = now()
      WHERE id = $1 AND company_id = $2 RETURNING *`,
    [args.id, args.companyId, args.broll_suggestions, args.voice_over_script, args.edit_notes],
  );
}

export async function updateStatus(
  q: Queryable | undefined,
  args: {
    id: string;
    companyId: string;
    status: ReelsStatus;
    rejectionFeedback?: string | null;
    incrementRevision?: boolean;
  },
): Promise<ReelsScriptRow> {
  return oneOrThrow<ReelsScriptRow>(
    q,
    `UPDATE public.reels_scripts
        SET status = $3::public.reels_script_status,
            rejection_feedback = $4,
            revision_count = revision_count + $5,
            updated_at = now()
      WHERE id = $1 AND company_id = $2 RETURNING *`,
    [
      args.id,
      args.companyId,
      args.status,
      args.rejectionFeedback ?? null,
      args.incrementRevision ? 1 : 0,
    ],
  );
}

export async function deleteReel(
  q: Queryable | undefined,
  id: string,
  companyId: string,
): Promise<void> {
  await exec(
    q,
    `DELETE FROM public.reels_scripts WHERE id = $1 AND company_id = $2`,
    [id, companyId],
  );
}
