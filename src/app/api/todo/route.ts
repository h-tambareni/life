import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { Task } from "@/types/todo";

const STATE_ID = "life-todo-state";

type TodoRow = {
  id: string;
  data: { tasks: Task[] } | null;
  updated_at: string | null;
};

const emptyResponse = (message?: string) =>
  NextResponse.json({
    enabled: false,
    data: null,
    message,
  });

export async function GET() {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return emptyResponse("Supabase environment variables are not configured.");
  }

  const { data, error } = await supabase
    .from("dashboard_state")
    .select("id, data, updated_at")
    .eq("id", STATE_ID)
    .maybeSingle();

  if (error) {
    console.error("Supabase GET error", error);
    return NextResponse.json(
      {
        enabled: true,
        data: null,
        message: error.message,
      },
      { status: 500 },
    );
  }

  const row = data as TodoRow | null;

  return NextResponse.json({
    enabled: true,
    data: row?.data ?? null,
    updatedAt: row?.updated_at ?? null,
  });
}

export async function POST(request: NextRequest) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return emptyResponse("Supabase environment variables are not configured.");
  }

  let payload: { tasks: Task[] };
  try {
    payload = (await request.json()) as { tasks: Task[] };
  } catch (error) {
    console.error("Invalid todo sync payload", error);
    return NextResponse.json(
      { enabled: true, message: "Invalid JSON payload" },
      { status: 400 },
    );
  }

  const sanitized = {
    tasks: payload.tasks ?? [],
  };

  const { error } = await supabase.from("dashboard_state").upsert(
    {
      id: STATE_ID,
      data: sanitized,
    },
    { onConflict: "id" },
  );

  if (error) {
    console.error("Supabase POST error", error);
    return NextResponse.json(
      {
        enabled: true,
        message: error.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    enabled: true,
    ok: true,
    updatedAt: new Date().toISOString(),
  });
}

