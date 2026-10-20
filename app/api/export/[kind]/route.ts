import { NextResponse, type NextRequest } from "next/server";
import { archiveFilterFrom } from "@/core/answer-archive";
import { getSession, getWorkspaceForUser } from "@/core/auth/session";
import { csvStream, exportRows, isExportKind } from "@/core/exports";
import { filterWindow, parseFilter } from "@/core/filters";
import { getDb } from "@/db/client";

/**
 * GET /api/export/answers.csv?range=7d&engine=chatgpt&country=US
 * Streams a CSV of the signed-in workspace's data, filtered by the same
 * search params as the page it was downloaded from. Answers, mentions and
 * citations also take the Answers page's filters (prompt, run, named, q);
 * there, range=all means any time.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in to export.", { status: 401 });
  const membership = await getWorkspaceForUser(session.user.id);
  if (!membership) return new NextResponse("No workspace.", { status: 404 });

  const kind = (await params).kind.replace(/\.csv$/, "");
  if (!isExportKind(kind)) return new NextResponse("Unknown export.", { status: 404 });

  const q = request.nextUrl.searchParams;
  const view = parseFilter(q);
  const window = filterWindow(view);
  // the dashboards default to 30 days; "all" (from the Answers page) means any time
  const archive = archiveFilterFrom(q);
  if (q.get("range") !== "all" && !archive.since) archive.since = window.since;

  const db = getDb();
  const rows = exportRows(db, membership.workspace.id, kind, {
    archive: { ...archive, page: undefined },
    metrics: window.metrics,
  });
  const today = new Date().toISOString().slice(0, 10);
  return new Response(csvStream(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="openvisibility-${kind}-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
