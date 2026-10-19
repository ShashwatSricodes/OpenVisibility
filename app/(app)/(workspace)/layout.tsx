import { requireWorkspace } from "@/core/auth/session";
import { getFreeTierUsage } from "@/core/usage";
import { getDb } from "@/db/client";
import { MobileNav, Sidebar } from "../_components/sidebar";

/* Every page in here needs a signed-in user; without one, requireWorkspace
   redirects to /login. The middleware only checks that a cookie exists. */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { user, workspace } = await requireWorkspace();
  const account = {
    email: user.email,
    workspace: workspace.name,
    hosted: workspace.mode === "hosted",
  };
  const usage = await getFreeTierUsage(getDb(), workspace.id);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[216px_minmax(0,1fr)]">
      <MobileNav account={account} />
      <Sidebar account={account} usage={usage} />
      <div className="lg:py-2 lg:pr-2">
        <div className="min-h-screen bg-panel lg:min-h-[calc(100vh-1rem)] lg:rounded-xl lg:border lg:border-line">
          {children}
        </div>
      </div>
    </div>
  );
}
